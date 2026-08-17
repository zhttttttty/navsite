/**
 * 数据管理器 - 处理导航数据获取、缓存、默认数据等
 */
class DataManager {
  constructor() {
    this.navigationData = {};
    this.categories = [];
    this.dateInfo = null;
    this.CACHE_DURATION = 60 * 60 * 1000; // 缓存1小时
    this.CACHE_KEY = 'navsite_navigation_cache'; // LocalStorage键名
    this.ADMIN_TOKEN_KEY = 'navsite_admin_token'; // 仅保存在当前浏览器会话
  }

  // 从LocalStorage读取缓存数据
  readCacheFromStorage() {
    try {
      const cachedData = localStorage.getItem(this.CACHE_KEY);
      if (!cachedData) return null;

      const parsedData = JSON.parse(cachedData);

      // 检查缓存是否过期
      if (Date.now() - parsedData.timestamp > this.CACHE_DURATION) {
        localStorage.removeItem(this.CACHE_KEY); // 删除过期缓存
        return null;
      }

      return parsedData;
    } catch (error) {
      console.warn('读取缓存数据失败:', error);
      localStorage.removeItem(this.CACHE_KEY); // 删除损坏的缓存
      return null;
    }
  }

  // 将缓存数据写入LocalStorage
  writeCacheToStorage(data, categories, dateInfo) {
    try {
      const cacheData = {
        data: data,
        categories: categories,
        dateInfo: dateInfo,
        timestamp: Date.now()
      };
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('写入缓存数据失败:', error);
      // 静默处理写入失败，不影响主要功能
    }
  }

  // 获取导航数据
  async fetchNavigationData(forceRefresh = false) {
    // 检查是否强制刷新
    if (!forceRefresh) {
      // 尝试从LocalStorage读取缓存
      const cachedData = this.readCacheFromStorage();
      if (cachedData) {
        console.log('使用LocalStorage缓存数据');
        this.navigationData = cachedData.data;
        this.categories = cachedData.categories;
        this.dateInfo = cachedData.dateInfo;
        return {
          success: true,
          data: this.navigationData,
          categories: this.categories,
          dateInfo: cachedData.dateInfo,
          fromCache: true
        };
      }
    }

    try {
      const response = await fetch('/api/navigation');

      // 检查响应状态
      if (!response.ok) {
        console.warn(`API 请求失败: ${response.status} ${response.statusText}`);
        return this.useDefaultNavigationData();
      }

      // 检查内容类型
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('API 返回非 JSON 数据，使用默认数据');
        return this.useDefaultNavigationData();
      }

      const result = await response.json();
      console.log('获取导航数据:', result);

      if (result.success) {
        this.navigationData = result.data;
        this.categories = result.categories;
        this.dateInfo = result.dateInfo;
        const isMockData = result.isMockData;

        if (result.degraded) {
          console.warn('导航服务当前处于降级状态，正在展示演示数据');
        }

        // 只有非模拟数据才进行缓存
        if (!isMockData) {
          console.log('非模拟数据，开始缓存...');
          this.writeCacheToStorage(result.data, result.categories, result.dateInfo);
        } else {
          console.log('检测到模拟数据，不进行缓存');
        }

        return result;
      } else {
        console.warn('获取导航数据失败:', result.message);
        return this.useDefaultNavigationData();
      }
    } catch (error) {
      console.warn('获取导航数据异常:', error);
      return this.useDefaultNavigationData();
    }
  }

  // 使用默认导航数据
  useDefaultNavigationData() {
    console.log('使用默认导航数据');

    // 默认分类
    this.categories = ['Code', '设计', '工具', '学习'];

    // 默认导航数据
    this.navigationData = {
      'Code': [
        { name: 'GitHub', url: 'https://github.com', icon: '🐙' },
        { name: 'Stack Overflow', url: 'https://stackoverflow.com', icon: '📚' },
        { name: 'VS Code', url: 'https://code.visualstudio.com', icon: '💻' }
      ],
      '设计': [
        { name: 'Figma', url: 'https://figma.com', icon: '🎨' },
        { name: 'Dribbble', url: 'https://dribbble.com', icon: '🏀' },
        { name: 'Behance', url: 'https://behance.net', icon: '📐' }
      ],
      '工具': [
        { name: 'Google', url: 'https://google.com', icon: '🔍' },
        { name: '翻译', url: 'https://translate.google.com', icon: '🌐' },
        { name: '时间', url: 'https://time.is', icon: '⏰' }
      ],
      '学习': [
        { name: 'MDN', url: 'https://developer.mozilla.org', icon: '📖' },
        { name: 'W3Schools', url: 'https://w3schools.com', icon: '🎓' },
        { name: 'FreeCodeCamp', url: 'https://freecodecamp.org', icon: '💡' }
      ]
    };

    const now = new Date();
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    this.dateInfo = {
      date: `${now.getMonth() + 1}月${now.getDate()}日`,
      weekday: weekdays[now.getDay()],
      lunarDate: ''
    };

    // 默认数据不再缓存，以便下次尝试从API获取最新数据

    return {
      success: true,
      data: this.navigationData,
      categories: this.categories,
      dateInfo: this.dateInfo,
      fromDefault: true
    };
  }

  // 添加链接
  async addLink(linkData) {
    try {
      const adminToken = this.getAdminToken(true);
      if (!adminToken) {
        return { success: false, message: '已取消管理员验证' };
      }

      const response = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(linkData)
      });

      const result = await response.json();

      if (response.status === 401 || result.code === 'ADMIN_NOT_CONFIGURED') {
        this.clearAdminToken();
      }

      if (result.success) {
        // 清除缓存，强制下次重新获取数据
        this.clearCache();
      }

      return result;
    } catch (error) {
      console.error('添加链接异常:', error);
      return {
        success: false,
        message: '网络错误，请检查网络连接后重试'
      };
    }
  }

  // 删除链接
  async deleteLink(linkId) {
    try {
      const adminToken = this.getAdminToken(true);
      if (!adminToken) {
        return { success: false, message: '已取消管理员验证' };
      }

      const response = await fetch(`/api/links/${linkId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });

      const result = await response.json();

      if (response.status === 401 || result.code === 'ADMIN_NOT_CONFIGURED') {
        this.clearAdminToken();
      }

      if (result.success) {
        // 清除缓存，强制下次重新获取数据
        this.clearCache();
      }

      return result;
    } catch (error) {
      console.error('删除链接异常:', error);
      return {
        success: false,
        message: '网络错误，请检查网络连接后重试'
      };
    }
  }

  // 清除缓存
  clearCache() {
    try {
      localStorage.removeItem(this.CACHE_KEY);
      console.log('已清除LocalStorage缓存');
    } catch (error) {
      console.warn('清除缓存失败:', error);
    }
  }

  // 管理员令牌仅存储在当前标签页会话中，关闭浏览器后自动失效
  getAdminToken(promptIfMissing = false) {
    let token = '';
    try {
      token = sessionStorage.getItem(this.ADMIN_TOKEN_KEY) || '';
    } catch (error) {
      console.warn('无法读取管理员会话:', error);
    }

    if (!token && promptIfMissing) {
      token = window.prompt('请输入管理员令牌')?.trim() || '';
      if (token) {
        try {
          sessionStorage.setItem(this.ADMIN_TOKEN_KEY, token);
        } catch (error) {
          console.warn('无法保存管理员会话:', error);
        }
      }
    }

    return token;
  }

  clearAdminToken() {
    try {
      sessionStorage.removeItem(this.ADMIN_TOKEN_KEY);
    } catch (error) {
      console.warn('无法清除管理员会话:', error);
    }
  }

  // 获取当前数据
  getCurrentData() {
    return {
      navigationData: this.navigationData,
      categories: this.categories,
      dateInfo: this.dateInfo
    };
  }

  // 检查缓存是否有效
  isCacheValid() {
    const cachedData = this.readCacheFromStorage();
    return cachedData !== null;
  }
}

// 导出数据管理器
window.DataManager = DataManager;
