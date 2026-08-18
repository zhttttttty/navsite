require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const dns = require('node:dns').promises;
const axios = require('axios');
const { rateLimit } = require('express-rate-limit');
const { Lunar } = require('lunar-javascript');

const app = express();
const PORT = process.env.PORT || 3000;
const FEISHU_ENV_KEYS = ['APP_ID', 'APP_SECRET', 'APP_TOKEN', 'TABLE_ID'];
const ADMIN_TOKEN_MIN_LENGTH = 6;
const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: '管理员操作过于频繁，请稍后重试'
  }
});

app.disable('x-powered-by');

// 解析JSON请求体并限制匿名请求的内存占用
app.use(express.json({ limit: '16kb' }));

// 基础安全响应头。当前页面使用内联样式，因此仅对样式保留 unsafe-inline。
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join('; '),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  next();
});

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 缓存tenant_access_token及其过期时间
let cachedToken = null;
let tokenExpireTime = null;
const faviconCache = new Map();
const FAVICON_CACHE_TTL = 24 * 60 * 60 * 1000;
const FAVICON_CACHE_LIMIT = 250;
const allowedLanTargets = new Set();
const feishuIconSources = new Map();
const feishuIconCache = new Map();
const NAVIGATION_AVATAR_URL = 'https://t.alcy.cc/ycy/';
const NAVIGATION_AVATAR_CACHE_TTL = 30 * 60 * 1000;
let navigationAvatarCache = null;

function getConfigurationStatus() {
  const missingFeishu = FEISHU_ENV_KEYS.filter(key => !process.env[key]);
  return {
    feishuConfigured: missingFeishu.length === 0,
    adminConfigured: typeof process.env.ADMIN_TOKEN === 'string'
      && process.env.ADMIN_TOKEN.length >= ADMIN_TOKEN_MIN_LENGTH,
    missingFeishu
  };
}

function getSafeExternalError(error) {
  return {
    status: error?.response?.status,
    code: error?.response?.data?.code,
    message: error?.response?.data?.msg || error?.code || error?.message
  };
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(req, res, next) {
  const configuredToken = process.env.ADMIN_TOKEN;
  if (typeof configuredToken !== 'string' || configuredToken.length < ADMIN_TOKEN_MIN_LENGTH) {
    return res.status(503).json({
      success: false,
      code: 'ADMIN_NOT_CONFIGURED',
      message: '管理员功能尚未配置'
    });
  }

  const authorization = req.get('authorization') || '';
  const providedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!constantTimeEqual(providedToken, configuredToken)) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: '管理员令牌无效或已过期'
    });
  }

  next();
}

function parseHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value.trim());
    const supportedProtocol = ['http:', 'https:'].includes(parsed.protocol);
    return supportedProtocol && !parsed.username && !parsed.password ? parsed : null;
  } catch (error) {
    return null;
  }
}

function normalizeIpAddress(value) {
  const firstValue = String(value || '').split(',')[0].trim().replace(/^\[|\]$/g, '');
  return firstValue.toLowerCase().startsWith('::ffff:') ? firstValue.slice(7) : firstValue;
}

function isPrivateNetworkAddress(value) {
  const address = normalizeIpAddress(value);
  if (!address) return false;
  if (address === '::1' || address === 'localhost') return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(address) || /^fe[89ab][0-9a-f]:/i.test(address)) return true;

  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
}

function isPrivateNetworkHostname(value) {
  const hostname = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return isPrivateNetworkAddress(hostname) || hostname === 'localhost' || hostname.endsWith('.local');
}

function getClientNetworkInfo(req) {
  const forwardedAddress = req.get('x-forwarded-for');
  const clientAddress = normalizeIpAddress(forwardedAddress || req.socket?.remoteAddress || req.ip);
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const requestHost = forwardedHost || req.hostname || req.get('host') || '';
  const hostname = requestHost.replace(/^\[|\](:\d+)?$/g, '').replace(/:\d+$/, '');
  const addressIsLan = isPrivateNetworkAddress(clientAddress);
  const hostnameIsLan = isPrivateNetworkHostname(hostname);

  return {
    isLan: addressIsLan || hostnameIsLan,
    reason: addressIsLan ? 'private_client_ip' : hostnameIsLan ? 'private_hostname' : 'public_network',
    clientAddress,
    hostname
  };
}

function rememberAllowedLanTargets(groupedData) {
  allowedLanTargets.clear();
  Object.values(groupedData || {}).flat().forEach(record => {
    const parsed = parseHttpUrl(record?.lanUrl);
    if (parsed) allowedLanTargets.add(parsed.href);
  });
}

function getFeishuAttachmentSource(value) {
  if (!Array.isArray(value)) return null;
  const attachment = value.find(item => {
    const type = String(item?.type || '').toLowerCase();
    return item?.file_token && (type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|ico|svg)$/i.test(item?.name || ''));
  });
  if (!attachment) return null;

  let downloadUrl = '';
  try {
    const parsed = new URL(attachment.url || '');
    const expectedPath = `/open-apis/drive/v1/medias/${encodeURIComponent(attachment.file_token)}/download`;
    if (parsed.protocol === 'https:' && parsed.hostname === 'open.feishu.cn' && parsed.pathname === expectedPath) {
      downloadUrl = parsed.href;
    }
  } catch (error) {
    // Fall back to the documented media download endpoint below.
  }

  return {
    fileToken: String(attachment.file_token),
    contentType: String(attachment.type || ''),
    downloadUrl: downloadUrl
      || `https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(attachment.file_token)}/download`
  };
}

function rememberFeishuIconSources(groupedData) {
  feishuIconSources.clear();
  Object.values(groupedData || {}).flat().forEach(record => {
    if (record?._iconAttachment && /^[A-Za-z0-9_-]{1,128}$/.test(record.id || '')) {
      feishuIconSources.set(record.id, record._iconAttachment);
    }
  });
}

async function fetchFeishuIcon(source, accessToken, client = axios, forceRefresh = false) {
  if (!source?.fileToken || !source?.downloadUrl || !accessToken) {
    throw new Error('飞书图标下载参数不完整');
  }
  const cacheKey = source.fileToken;
  const cached = feishuIconCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached;

  const response = await client.get(source.downloadUrl, {
    responseType: 'arraybuffer',
    timeout: 8000,
    maxContentLength: 5 * 1024 * 1024,
    maxRedirects: 0,
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const responseContentType = String(response.headers?.['content-type'] || '').split(';')[0];
  const contentType = responseContentType.startsWith('image/') ? responseContentType : source.contentType;
  if (!contentType.startsWith('image/') || !response.data || response.data.length < 32) {
    throw new Error('飞书附件不是有效图片');
  }

  const result = { data: response.data, contentType, expiresAt: Date.now() + FAVICON_CACHE_TTL };
  if (feishuIconCache.size >= FAVICON_CACHE_LIMIT) feishuIconCache.delete(feishuIconCache.keys().next().value);
  feishuIconCache.set(cacheKey, result);
  return result;
}

async function resolvesToPrivateNetwork(hostname, resolver = dns.lookup) {
  if (isPrivateNetworkHostname(hostname)) return true;
  try {
    const addresses = await resolver(hostname, { all: true, verbatim: true });
    return Array.isArray(addresses)
      && addresses.length > 0
      && addresses.every(result => isPrivateNetworkAddress(result.address));
  } catch (error) {
    return false;
  }
}

function getIconCandidates(html, targetUrl) {
  const candidates = [];
  const linkPattern = /<link\b[^>]*>/gi;
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/i;
  const relPattern = /\brel\s*=\s*["']([^"']+)["']/i;
  for (const tag of String(html || '').match(linkPattern) || []) {
    const rel = tag.match(relPattern)?.[1] || '';
    const href = tag.match(hrefPattern)?.[1];
    if (!href || !/\b(?:icon|apple-touch-icon)\b/i.test(rel)) continue;
    try {
      const candidate = new URL(href, targetUrl);
      if (candidate.origin === targetUrl.origin && ['http:', 'https:'].includes(candidate.protocol)) {
        candidates.push(candidate.href);
      }
    } catch (error) {
      // Ignore malformed icon declarations and continue with conventional paths.
    }
  }
  candidates.push(new URL('/favicon.ico', targetUrl.origin).href);
  return [...new Set(candidates)].slice(0, 6);
}

async function fetchDirectFavicon(value, client = axios, resolver = dns.lookup, forceRefresh = false) {
  const targetUrl = parseHttpUrl(value);
  if (!targetUrl || !await resolvesToPrivateNetwork(targetUrl.hostname, resolver)) {
    throw new Error('内网图标目标无效或不在私有网络');
  }

  const cacheKey = `direct:${targetUrl.origin}`;
  const cached = faviconCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached;

  let html = '';
  try {
    const pageResponse = await client.get(targetUrl.href, {
      responseType: 'text',
      timeout: 3500,
      maxContentLength: 256 * 1024,
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 300
    });
    if (String(pageResponse.headers?.['content-type'] || '').includes('text/html')) {
      html = pageResponse.data;
    }
  } catch (error) {
    // Many appliances block their home page while still serving /favicon.ico.
  }

  let lastError;
  for (const iconUrl of getIconCandidates(html, targetUrl)) {
    try {
      const response = await client.get(iconUrl, {
        responseType: 'arraybuffer',
        timeout: 3500,
        maxContentLength: 1024 * 1024,
        maxRedirects: 0,
        validateStatus: status => status >= 200 && status < 300
      });
      const contentType = String(response.headers?.['content-type'] || '').split(';')[0];
      if (!contentType.startsWith('image/') || !response.data || response.data.length < 32) {
        throw new Error('内网服务返回了无效图标');
      }
      const result = { data: response.data, contentType, expiresAt: Date.now() + FAVICON_CACHE_TTL };
      if (faviconCache.size >= FAVICON_CACHE_LIMIT) faviconCache.delete(faviconCache.keys().next().value);
      faviconCache.set(cacheKey, result);
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('未找到内网应用图标');
}

async function fetchFavicon(hostname, size, client = axios, forceRefresh = false) {
  const cacheKey = `${hostname}:${size}`;
  const cached = faviconCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const providers = [
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`
  ];
  let lastError;

  for (const providerUrl of providers) {
    try {
      const response = await client.get(providerUrl, {
        responseType: 'arraybuffer',
        timeout: 5000,
        maxContentLength: 1024 * 1024
      });
      const contentType = response.headers?.['content-type'] || '';
      if (!contentType.startsWith('image/') || !response.data || response.data.length < 100) {
        throw new Error('图标服务返回了无效图片');
      }

      const result = {
        data: response.data,
        contentType,
        expiresAt: Date.now() + FAVICON_CACHE_TTL
      };
      if (faviconCache.size >= FAVICON_CACHE_LIMIT) {
        faviconCache.delete(faviconCache.keys().next().value);
      }
      faviconCache.set(cacheKey, result);
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('未找到可用的网站图标');
}

async function fetchNavigationAvatar(client = axios) {
  if (navigationAvatarCache?.expiresAt > Date.now()) return navigationAvatarCache;

  const response = await client.get(NAVIGATION_AVATAR_URL, {
    responseType: 'arraybuffer',
    timeout: 10000,
    maxContentLength: 5 * 1024 * 1024
  });
  const contentType = response.headers?.['content-type'] || '';
  if (!contentType.startsWith('image/') || !response.data || response.data.length < 100) {
    throw new Error('随机图片服务返回了无效内容');
  }

  navigationAvatarCache = {
    data: response.data,
    contentType,
    expiresAt: Date.now() + NAVIGATION_AVATAR_CACHE_TTL
  };
  return navigationAvatarCache;
}

function normalizeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// 获取tenant_access_token
async function getTenantAccessToken() {
  // 检查缓存的token是否存在且未过期（预留5分钟的缓冲时间）
  const now = Date.now();
  if (cachedToken && tokenExpireTime && now < tokenExpireTime - 5 * 60 * 1000) {
    console.log('使用缓存的tenant_access_token');
    return cachedToken;
  }

  try {
    const configuration = getConfigurationStatus();
    if (!configuration.feishuConfigured) {
      throw new Error(`飞书配置缺失: ${configuration.missingFeishu.join(', ')}`);
    }

    console.log('重新获取tenant_access_token');
    const response = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: process.env.APP_ID,
        app_secret: process.env.APP_SECRET
      },
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );

    if (response.data.code === 0) {
      // 缓存token和过期时间（飞书token有效期为2小时）
      cachedToken = response.data.tenant_access_token;
      // 计算过期时间（当前时间 + token有效期(秒) * 1000）
      tokenExpireTime = now + response.data.expire * 1000;
      return cachedToken;
    } else {
      console.error('获取tenant_access_token失败:', {
        code: response.data.code,
        message: response.data.msg
      });
      throw new Error(`获取tenant_access_token失败: ${response.data.msg}`);
    }
  } catch (error) {
    console.error('获取tenant_access_token异常:', getSafeExternalError(error));
    throw error;
  }
}

// 获取多维表格数据
async function getBitableData(token, client = axios) {
  try {
    const items = [];
    let pageToken;
    let pageCount = 0;

    do {
      pageCount += 1;
      if (pageCount > 100) {
        throw new Error('飞书分页超过安全上限');
      }
      const response = await client.get(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.APP_TOKEN}/tables/${process.env.TABLE_ID}/records`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8'
          },
          params: {
            page_size: 100,
            ...(pageToken ? { page_token: pageToken } : {})
          },
          timeout: 10000,
          maxContentLength: 5 * 1024 * 1024
        }
      );

      if (response.data.code !== 0) {
        console.error('获取多维表格数据失败:', {
          code: response.data.code,
          message: response.data.msg
        });
        throw new Error(`获取多维表格数据失败: ${response.data.msg}`);
      }

      const pageData = response.data.data || {};
      items.push(...(Array.isArray(pageData.items) ? pageData.items : []));
      pageToken = pageData.has_more ? pageData.page_token : undefined;
    } while (pageToken);

    return items;
  } catch (error) {
    console.error('获取多维表格数据异常:', getSafeExternalError(error));
    throw error;
  }
}

// 获取农历日期字符串
function getLunarDateString() {
  const date = new Date();
  const lunar = Lunar.fromDate(date);
  let result = '';
  
  // 处理闰月
  if (lunar.isLeap) {
    result += '闰';
  }
  
  // 月份和日期
  result += lunar.getMonthInChinese() + '月' + lunar.getDayInChinese();
  
  // 获取节气
  const jieQi = lunar.getJieQi();
  if (jieQi) {
    result += ' ' + jieQi;
  }
  
  return result;
}

// 处理多维表格数据
function processTableData(items) {
  // 提取记录并按分类分组
  const records = items.map(item => {
    const fields = item?.fields || {};
    const localizedUrl = fields.网址;
    const rawUrl = fields.url || (typeof localizedUrl === 'string' ? localizedUrl : localizedUrl?.link) || '';
    const rawName = fields.name || fields.站点名称 || '';
    const localizedLanUrl = fields.内网地址;
    const rawLanUrl = fields.lanUrl
      || (typeof localizedLanUrl === 'string' ? localizedLanUrl : localizedLanUrl?.link)
      || '';
    // 如果站点名称和网址都为空，则跳过该记录
    if (!rawName && !rawUrl) {
      return null;
    }
    const rawSort = fields.sort ?? fields.weight ?? fields.排序 ?? 0;
    const numericSort = Number(rawSort);
    const localizedIcon = fields.备用图标;
    const iconAttachment = getFeishuAttachmentSource(fields.icon);
    const record = {
      id: item.record_id, // 添加记录ID
      name: normalizeText(rawName, 50),
      url: typeof rawUrl === 'string' ? rawUrl.trim() : '',
      category: normalizeText(fields.category || fields.分类 || '其它', 20) || '其它',
      sort: Number.isFinite(numericSort) ? numericSort : 0,
      lanUrl: typeof rawLanUrl === 'string' ? rawLanUrl.trim() : '',
      icon: iconAttachment ? `/api/feishu-icon/${encodeURIComponent(item.record_id)}` : (typeof fields.icon === 'string' ? fields.icon : fields?.icon?.link)
        || (typeof localizedIcon === 'string' ? localizedIcon : localizedIcon?.link)
        || ''
    };
    if (iconAttachment) {
      Object.defineProperty(record, '_iconAttachment', { value: iconAttachment, enumerable: false });
    }
    return record;
  }).filter(record => record !== null); // 过滤掉空记录

  // 按分类分组
  const groupedByCategory = Object.create(null);
  records.forEach(record => {
    if (!groupedByCategory[record.category]) {
      groupedByCategory[record.category] = [];
    }
    groupedByCategory[record.category].push(record);
  });

  // 每个分类内按排序字段排序
  Object.keys(groupedByCategory).forEach(category => {
    groupedByCategory[category].sort((a, b) => a.sort - b.sort);
  });

  return groupedByCategory;
}

// 模拟数据（当无法连接飞书API时使用）
const mockData = {
  'Code': [
    { id: 'mock_001', name: 'GitHub', url: 'https://github.com', category: 'Code', sort: 1, icon: '' },
    { id: 'mock_002', name: 'Stack Overflow', url: 'https://stackoverflow.com', category: 'Code', sort: 2, icon: '' },
    { id: 'mock_003', name: 'VSCode', url: 'https://code.visualstudio.com', category: 'Code', sort: 3, icon: '' },
    { id: 'mock_004', name: 'CodePen', url: 'https://codepen.io', category: 'Code', sort: 4, icon: '' }
  ],
  '设计': [
    { id: 'mock_005', name: 'Figma', url: 'https://figma.com', category: '设计', sort: 1, icon: '' },
    { id: 'mock_006', name: 'Dribbble', url: 'https://dribbble.com', category: '设计', sort: 2, icon: '' },
    { id: 'mock_007', name: 'Behance', url: 'https://behance.net', category: '设计', sort: 3, icon: '' },
    { id: 'mock_008', name: 'Unsplash', url: 'https://unsplash.com', category: '设计', sort: 4, icon: '' }
  ],
  '产品': [
    { id: 'mock_009', name: 'ProductHunt', url: 'https://producthunt.com', category: '产品', sort: 1, icon: '' },
    { id: 'mock_010', name: 'Trello', url: 'https://trello.com', category: '产品', sort: 2, icon: '' },
    { id: 'mock_011', name: 'Notion', url: 'https://notion.so', category: '产品', sort: 3, icon: '' },
    { id: 'mock_012', name: 'Asana', url: 'https://asana.com', category: '产品', sort: 4, icon: '' }
  ],
  '其它': [
    { id: 'mock_013', name: '百度', url: 'https://baidu.com', category: '其它', sort: 1, icon: '' },
    { id: 'mock_014', name: '微博', url: 'https://weibo.com', category: '其它', sort: 2, icon: '' },
    { id: 'mock_015', name: '知乎', url: 'https://zhihu.com', category: '其它', sort: 3, icon: '' },
    { id: 'mock_016', name: 'B站', url: 'https://bilibili.com', category: '其它', sort: 4, icon: '' }
  ]
};

// API路由 - 获取导航数据
app.get('/api/navigation', async (req, res) => {
  try {
    let data;
    let categories;
    let isMockData = false;
    // 尝试从飞书API获取数据
    try {
      const token = await getTenantAccessToken();
      const items = await getBitableData(token);
      data = processTableData(items);
      rememberAllowedLanTargets(data);
      rememberFeishuIconSources(data);
      categories = Object.keys(data);
    } catch (apiError) {
      console.warn('无法从飞书API获取数据，使用模拟数据:', getSafeExternalError(apiError));
      // 使用模拟数据
      data = mockData;
      rememberAllowedLanTargets(data);
      rememberFeishuIconSources(data);
      categories = Object.keys(mockData);
      isMockData = true;
    }
    
    // 获取中文星期
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const today = new Date();
    const chineseWeekday = weekdays[today.getDay()];
    
    res.set('Cache-Control', isMockData ? 'no-store' : 'private, max-age=60');
    res.json({
      success: true,
      isMockData: isMockData,
      degraded: isMockData,
      degradedReason: isMockData ? 'FEISHU_UNAVAILABLE' : null,
      data: data,
      categories: categories,
      timestamp: new Date().toISOString(),
      dateInfo: {
        time: `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`,
        date: `${today.getMonth() + 1}月${today.getDate()}日`,
        weekday: chineseWeekday,
        lunarDate: getLunarDateString()
      }
    });
  } catch (error) {
    console.error('API错误:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/health', (req, res) => {
  const configuration = getConfigurationStatus();
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    degraded: !configuration.feishuConfigured,
    feishuConfigured: configuration.feishuConfigured,
    adminConfigured: configuration.adminConfigured,
    missingConfiguration: configuration.missingFeishu,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/network-status', (req, res) => {
  const network = getClientNetworkInfo(req);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...network });
});

app.get('/api/feishu-icon/:recordId', async (req, res) => {
  try {
    const recordId = req.params.recordId;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(recordId || '')) {
      return res.status(400).json({ success: false, message: '记录ID格式无效' });
    }
    const accessToken = await getTenantAccessToken();
    let source = feishuIconSources.get(recordId);
    if (!source) {
      const items = await getBitableData(accessToken);
      const data = processTableData(items);
      rememberFeishuIconSources(data);
      source = feishuIconSources.get(recordId);
    }
    if (!source) {
      return res.status(404).json({ success: false, message: '未找到图标附件' });
    }
    const icon = await fetchFeishuIcon(source, accessToken, axios, Boolean(req.query.refresh));
    res.set('Content-Type', icon.contentType);
    res.set('Cache-Control', 'private, max-age=3600, stale-while-revalidate=86400');
    res.send(icon.data);
  } catch (error) {
    console.error('飞书图标代理错误:', getSafeExternalError(error));
    res.status(502).json({ success: false, code: 'FEISHU_ICON_UNAVAILABLE', message: '飞书图标暂时不可用' });
  }
});

// Favicon代理端点
app.get('/api/favicon', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: '缺少url参数'
      });
    }
    
    const parsedUrl = parseHttpUrl(url);
    if (!parsedUrl) {
      return res.status(400).json({
        success: false,
        message: '仅支持有效的HTTP或HTTPS网址'
      });
    }
    
    const requestedSize = Number.parseInt(req.query.size, 10);
    const faviconSize = [32, 64, 128].includes(requestedSize) ? requestedSize : 64;
    let favicon;
    if (allowedLanTargets.has(parsedUrl.href) && await resolvesToPrivateNetwork(parsedUrl.hostname)) {
      try {
        favicon = await fetchDirectFavicon(parsedUrl.href, axios, dns.lookup, Boolean(req.query.refresh));
      } catch (error) {
        favicon = await fetchFavicon(parsedUrl.hostname, faviconSize, axios, Boolean(req.query.refresh));
      }
    } else {
      favicon = await fetchFavicon(parsedUrl.hostname, faviconSize, axios, Boolean(req.query.refresh));
    }

    res.set('Content-Type', favicon.contentType);
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.send(favicon.data);
    
  } catch (error) {
    console.error('Favicon代理错误:', error.message);
    
    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
    res.status(404).json({
      success: false,
      code: 'FAVICON_NOT_FOUND',
      message: '未找到可用的网站图标'
    });
  }
});

app.get('/api/navigation-avatar', async (req, res) => {
  try {
    const avatar = await fetchNavigationAvatar();
    res.set('Content-Type', avatar.contentType);
    res.set('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400');
    res.send(avatar.data);
  } catch (error) {
    console.error('随机导航图片代理错误:', error.message);
    res.set('Cache-Control', 'no-store');
    res.status(502).json({
      success: false,
      code: 'NAVIGATION_AVATAR_UNAVAILABLE',
      message: '随机导航图片暂时不可用'
    });
  }
});

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 添加新的网站链接
app.post('/api/links', adminWriteLimiter, requireAdmin, async (req, res) => {
  try {
    // 解析请求体
    let requestBody = req.body;
    
    // 检查请求体是否存在
    if (!requestBody) {
      return res.status(400).json({
        success: false,
        message: '请求体不能为空'
      });
    }
    
    const name = normalizeText(requestBody.name, 50);
    const category = normalizeText(requestBody.category, 20);
    const parsedUrl = parseHttpUrl(requestBody.url);
    const parsedLanUrl = requestBody.lanUrl ? parseHttpUrl(requestBody.lanUrl) : null;
    const numericSort = Number(requestBody.sort ?? 200);

    // 验证必要的字段
    if (!name) {
      return res.status(400).json({
        success: false,
        message: '网站名称不能为空'
      });
    }
    
    if (!requestBody.url || !String(requestBody.url).trim()) {
      return res.status(400).json({
        success: false,
        message: '网站网址不能为空'
      });
    }
    
    if (!category) {
      return res.status(400).json({
        success: false,
        message: '分类不能为空'
      });
    }

    if (String(requestBody.category).trim().length > 20) {
      return res.status(400).json({
        success: false,
        message: '分类长度不能超过20个字符'
      });
    }
    
    if (!parsedUrl) {
      return res.status(400).json({
        success: false,
        message: '无效的网址格式，仅支持http://或https://'
      });
    }

    if (requestBody.lanUrl && !parsedLanUrl) {
      return res.status(400).json({
        success: false,
        message: '内网地址格式无效，仅支持http://或https://'
      });
    }
    
    // 验证网站名称长度
    if (String(requestBody.name).trim().length > 50) {
      return res.status(400).json({
        success: false,
        message: '网站名称长度不能超过50个字符'
      });
    }

    if (!Number.isInteger(numericSort) || numericSort < 0 || numericSort > 999) {
      return res.status(400).json({
        success: false,
        message: '排序必须是0到999之间的整数'
      });
    }
    
    // 获取飞书访问令牌
    const token = await getTenantAccessToken();
    
    // 构建请求体，符合飞书多维表格API的要求
    const createRecordBody = {
      fields: {
        name,
        url: parsedUrl.href,
        category,
        weight: numericSort
      }
    };
    if (parsedLanUrl) createRecordBody.fields.lanUrl = parsedLanUrl.href;
    
    // 调用飞书多维表格API创建记录
    const response = await axios.post(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.APP_TOKEN}/tables/${process.env.TABLE_ID}/records`,
      createRecordBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
    
    // 处理响应
    if (response.data.code === 0) {
      res.json({
        success: true,
        message: '链接添加成功',
        data: response.data.data
      });
    } else {
      console.error('飞书API错误:', { code: response.data.code, message: response.data.msg });
      res.status(500).json({
        success: false,
        message: `添加链接失败: ${response.data.msg || '未知错误'}`
      });
    }
  } catch (error) {
    console.error('添加链接异常:', getSafeExternalError(error));
    res.status(500).json({
      success: false,
      message: '添加链接失败，请稍后重试'
    });
  }
});

// 删除网站链接
app.delete('/api/links/:id', adminWriteLimiter, requireAdmin, async (req, res) => {
  try {
    const recordId = req.params.id;
    
    if (!recordId) {
      return res.status(400).json({
        success: false,
        message: '记录ID不能为空'
      });
    }

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(recordId)) {
      return res.status(400).json({
        success: false,
        message: '记录ID格式无效'
      });
    }
    
    // 获取飞书访问令牌
    const token = await getTenantAccessToken();
    
    // 调用飞书多维表格API删除记录
    const response = await axios.delete(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${process.env.APP_TOKEN}/tables/${process.env.TABLE_ID}/records/${recordId}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
    
    // 处理响应
    if (response.data.code === 0) {
      res.json({
        success: true,
        message: '链接删除成功',
        data: response.data.data
      });
    } else {
      console.error('飞书API错误:', { code: response.data.code, message: response.data.msg });
      res.status(500).json({
        success: false,
        message: `删除链接失败: ${response.data.msg || '未知错误'}`
      });
    }
  } catch (error) {
    console.error('删除链接异常:', getSafeExternalError(error));
    res.status(500).json({
      success: false,
      message: '删除链接失败，请稍后重试'
    });
  }
});

// 本地直接运行时启动端口；被测试或Vercel加载时导出Express应用。
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

module.exports = app;
module.exports._test = {
  constantTimeEqual,
  fetchFavicon,
  fetchDirectFavicon,
  fetchFeishuIcon,
  fetchNavigationAvatar,
  getBitableData,
  getConfigurationStatus,
  getFeishuAttachmentSource,
  getClientNetworkInfo,
  isPrivateNetworkAddress,
  parseHttpUrl,
  processTableData,
  requireAdmin
};
