const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const axios = require('axios');

const app = require('../server');
const {
  fetchFavicon,
  fetchDirectFavicon,
  fetchFeishuIcon,
  fetchNavigationAvatar,
  getBitableData,
  getFeishuAttachmentSource,
  isPrivateNetworkAddress,
  parseHttpUrl,
  processTableData
} = app._test;

let server;
let baseUrl;
const originalAdminToken = process.env.ADMIN_TOKEN;

before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (originalAdminToken === undefined) {
    delete process.env.ADMIN_TOKEN;
  } else {
    process.env.ADMIN_TOKEN = originalAdminToken;
  }
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

test('health endpoint reports configuration without exposing values', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.feishuConfigured, 'boolean');
  assert.equal(JSON.stringify(body).includes(process.env.APP_SECRET || '__missing__'), false);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('network status recognizes private forwarded client addresses', async () => {
  const { response, body } = await request('/api/network-status', {
    headers: { 'x-forwarded-for': '192.168.8.25' }
  });
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.isLan, true);
  assert.equal(body.reason, 'private_client_ip');
});

test('write endpoints fail closed when admin token is not configured', async () => {
  delete process.env.ADMIN_TOKEN;
  const { response, body } = await request('/api/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Example', url: 'https://example.com', category: 'Test' })
  });
  assert.equal(response.status, 503);
  assert.equal(body.code, 'ADMIN_NOT_CONFIGURED');
});

test('admin token must contain at least six characters', async () => {
  process.env.ADMIN_TOKEN = '12345';
  const { response, body } = await request('/api/links/example', {
    method: 'DELETE',
    headers: { authorization: 'Bearer 12345' }
  });
  assert.equal(response.status, 503);
  assert.equal(body.code, 'ADMIN_NOT_CONFIGURED');
});

test('write endpoints reject an invalid admin token', async () => {
  process.env.ADMIN_TOKEN = 'Ab12x9';
  const { response, body } = await request('/api/links/example', {
    method: 'DELETE',
    headers: { authorization: 'Bearer wrong-token' }
  });
  assert.equal(response.status, 401);
  assert.equal(body.code, 'UNAUTHORIZED');
});

test('link creation only accepts HTTP and HTTPS URLs', async () => {
  process.env.ADMIN_TOKEN = 'Ab12x9';
  const { response, body } = await request('/api/links', {
    method: 'POST',
    headers: {
      authorization: 'Bearer Ab12x9',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ name: 'Unsafe', url: 'javascript:alert(1)', category: 'Test' })
  });
  assert.equal(response.status, 400);
  assert.match(body.message, /http/);
});

test('link creation writes the existing English Feishu field schema', async () => {
  const originalPost = axios.post;
  const originalEnvironment = {
    APP_ID: process.env.APP_ID,
    APP_SECRET: process.env.APP_SECRET,
    APP_TOKEN: process.env.APP_TOKEN,
    TABLE_ID: process.env.TABLE_ID
  };
  let recordBody;

  process.env.ADMIN_TOKEN = 'Ab12x9';
  process.env.APP_ID = 'app-id';
  process.env.APP_SECRET = 'app-secret';
  process.env.APP_TOKEN = 'app-token';
  process.env.TABLE_ID = 'table-id';

  axios.post = async (url, body) => {
    if (url.includes('/tenant_access_token/')) {
      return { data: { code: 0, tenant_access_token: 'tenant-token', expire: 7200 } };
    }
    recordBody = body;
    return { data: { code: 0, data: { record: {} } } };
  };

  try {
    const { response, body } = await request('/api/links', {
      method: 'POST',
      headers: {
        authorization: 'Bearer Ab12x9',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'ChatGPT',
        url: 'https://chatgpt.com/',
        category: 'Code',
        sort: 200
      })
    });

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(recordBody, {
      fields: {
        name: 'ChatGPT',
        url: 'https://chatgpt.com/',
        category: 'Code',
        weight: 200
      }
    });
  } finally {
    axios.post = originalPost;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('link deletion validates record IDs before calling Feishu', async () => {
  process.env.ADMIN_TOKEN = 'Ab12x9';
  const { response, body } = await request('/api/links/bad%20id', {
    method: 'DELETE',
    headers: { authorization: 'Bearer Ab12x9' }
  });
  assert.equal(response.status, 400);
  assert.match(body.message, /记录ID/);
});

test('URL parser rejects executable and data protocols', () => {
  assert.equal(parseHttpUrl('javascript:alert(1)'), null);
  assert.equal(parseHttpUrl('data:text/html,test'), null);
  assert.equal(parseHttpUrl('https://example.com/path').hostname, 'example.com');
});

test('private network classification includes LAN and overlay ranges', () => {
  assert.equal(isPrivateNetworkAddress('10.0.0.2'), true);
  assert.equal(isPrivateNetworkAddress('172.31.4.5'), true);
  assert.equal(isPrivateNetworkAddress('192.168.1.10'), true);
  assert.equal(isPrivateNetworkAddress('100.64.0.5'), true);
  assert.equal(isPrivateNetworkAddress('8.8.8.8'), false);
});

test('favicon fetching falls back between providers and reuses its memory cache', async () => {
  const image = Buffer.alloc(128, 1);
  const calls = [];
  const client = {
    async get(url) {
      calls.push(url);
      if (url.includes('duckduckgo.com')) throw new Error('primary unavailable');
      return { data: image, headers: { 'content-type': 'image/png' } };
    }
  };

  const first = await fetchFavicon('fallback-test.example', 64, client);
  const second = await fetchFavicon('fallback-test.example', 64, client);

  assert.equal(first.data, image);
  assert.equal(second.data, image);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /duckduckgo\.com/);
  assert.match(calls[1], /google\.com/);
});

test('favicon fetching rejects invalid provider responses', async () => {
  const client = {
    async get() {
      return { data: Buffer.from('not an image'), headers: { 'content-type': 'text/plain' } };
    }
  };

  await assert.rejects(() => fetchFavicon('invalid-test.example', 64, client), /无效图片/);
});

test('direct LAN favicon fetching discovers the icon declared by a Docker app', async () => {
  const image = Buffer.alloc(128, 1);
  const calls = [];
  const client = {
    async get(url) {
      calls.push(url);
      if (url === 'http://docker.home:8080/app') {
        return {
          data: '<html><head><link rel="icon" href="/assets/docker.png"></head></html>',
          headers: { 'content-type': 'text/html; charset=utf-8' }
        };
      }
      return { data: image, headers: { 'content-type': 'image/png' } };
    }
  };
  const resolver = async () => [{ address: '192.168.1.12', family: 4 }];

  const favicon = await fetchDirectFavicon('http://docker.home:8080/app', client, resolver);
  assert.equal(favicon.data, image);
  assert.deepEqual(calls, [
    'http://docker.home:8080/app',
    'http://docker.home:8080/assets/docker.png'
  ]);

  await fetchDirectFavicon('http://docker.home:8080/app', client, resolver, true);
  assert.equal(calls.length, 4);
});

test('Feishu attachment icons keep the authenticated download URL and image type', async () => {
  const attachment = {
    file_token: 'boxcnIconToken',
    name: 'app.png',
    type: 'image/png',
    url: 'https://open.feishu.cn/open-apis/drive/v1/medias/boxcnIconToken/download?extra=table-permission'
  };
  const source = getFeishuAttachmentSource([attachment]);
  assert.equal(source.fileToken, 'boxcnIconToken');
  assert.match(source.downloadUrl, /extra=table-permission/);
  const sanitizedSource = getFeishuAttachmentSource([{ ...attachment, url: 'https://example.com/icon.png' }]);
  assert.equal(
    sanitizedSource.downloadUrl,
    'https://open.feishu.cn/open-apis/drive/v1/medias/boxcnIconToken/download'
  );

  const image = Buffer.alloc(128, 1);
  const calls = [];
  const client = {
    async get(url, options) {
      calls.push({ url, options });
      return { data: image, headers: { 'content-type': 'image/png' } };
    }
  };
  const icon = await fetchFeishuIcon(source, 'tenant-token', client);
  assert.equal(icon.data, image);
  assert.equal(calls[0].url, source.downloadUrl);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tenant-token');
});

test('navigation avatar proxy accepts image data from the fixed API', async () => {
  const image = Buffer.alloc(256, 1);
  const calls = [];
  const client = {
    async get(url, options) {
      calls.push({ url, options });
      return { data: image, headers: { 'content-type': 'image/webp' } };
    }
  };

  const avatar = await fetchNavigationAvatar(client);
  assert.equal(avatar.data, image);
  assert.equal(avatar.contentType, 'image/webp');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://t.alcy.cc/ycy/');
  assert.equal(calls[0].options.maxContentLength, 5 * 1024 * 1024);
});

test('table processing tolerates incomplete fields and prototype-like categories', () => {
  const grouped = processTableData([
    { record_id: 'one', fields: { 站点名称: 'No URL', 分类: '其它' } },
    { record_id: 'two', fields: { 站点名称: 'Safe', 网址: { link: 'https://example.com' }, 分类: '__proto__' } },
    {
      record_id: 'three',
      fields: {
        name: 'English',
        url: 'https://example.org',
        lanUrl: 'http://192.168.1.20:8080',
        icon: 'https://example.org/icon.png',
        category: 'Code',
        weight: 250
      }
    },
    {
      record_id: 'attachment_record',
      fields: {
        name: 'Attachment icon',
        url: 'https://attachment.example',
        category: 'Media',
        icon: [{
          file_token: 'boxcnAttachment',
          name: 'attachment.webp',
          type: 'image/webp',
          url: 'https://open.feishu.cn/open-apis/drive/v1/medias/boxcnAttachment/download'
        }]
      }
    }
  ]);

  assert.equal(Object.getPrototypeOf(grouped), null);
  assert.equal(grouped['其它'][0].url, '');
  assert.equal(grouped['__proto__'][0].name, 'Safe');
  assert.equal(grouped.Code[0].sort, 250);
  assert.equal(grouped.Code[0].lanUrl, 'http://192.168.1.20:8080');
  assert.equal(grouped.Code[0].icon, 'https://example.org/icon.png');
  assert.equal(grouped.Media[0].icon, '/api/feishu-icon/attachment_record');
  assert.equal(grouped.Media[0]._iconAttachment.fileToken, 'boxcnAttachment');
  assert.equal(JSON.stringify(grouped.Media[0]).includes('boxcnAttachment'), false);
});

test('Feishu records are read across all pages', async () => {
  const calls = [];
  const client = {
    async get(url, options) {
      calls.push(options.params);
      if (!options.params.page_token) {
        return {
          data: {
            code: 0,
            data: { items: [{ record_id: 'one' }], has_more: true, page_token: 'next' }
          }
        };
      }
      return {
        data: {
          code: 0,
          data: { items: [{ record_id: 'two' }], has_more: false }
        }
      };
    }
  };

  const items = await getBitableData('token', client);
  assert.deepEqual(items.map(item => item.record_id), ['one', 'two']);
  assert.deepEqual(calls, [{ page_size: 100 }, { page_size: 100, page_token: 'next' }]);
});
