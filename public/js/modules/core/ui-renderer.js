/**
 * UI渲染器 - 处理DOM元素渲染、工具项生成、分类菜单等
 */
class UIRenderer {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.currentCategory = 'all';
    this.faviconCache = new Map();

    // DOM元素引用
    this.categoryMenu = document.getElementById('category-menu');
    this.toolsGrid = document.getElementById('tools-grid');
    this.currentTimeEl = document.getElementById('current-time');
    this.dateInfoEl = document.getElementById('date-info');
  }

  // 生成分类菜单
  generateCategoryMenu() {
    if (!this.categoryMenu) return;

    const { categories } = this.dataManager.getCurrentData();

    // 保留第一个"主页"菜单项
    const homeMenuItem = this.categoryMenu.firstElementChild;
    this.categoryMenu.innerHTML = '';
    if (homeMenuItem) {
      this.categoryMenu.appendChild(homeMenuItem);
    }

    // 添加分类菜单项
    categories.forEach(category => {
      const li = document.createElement('li');
      li.setAttribute('data-category', category);

      // 根据分类名称选择合适的图标
      let iconClass = 'bi-folder';
      if (category.includes('Code') || category.includes('代码')) {
        iconClass = 'bi-code-square';
      } else if (category.includes('设计')) {
        iconClass = 'bi-palette';
      } else if (category.includes('产品')) {
        iconClass = 'bi-diagram-3';
      }

      const icon = document.createElement('i');
      icon.className = `bi ${iconClass}`;
      icon.setAttribute('aria-hidden', 'true');
      li.appendChild(icon);
      li.appendChild(document.createTextNode(` ${category}`));
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.addEventListener('click', () => this.showTools(category));
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.showTools(category);
        }
      });
      this.categoryMenu.appendChild(li);
    });
  }

  // 显示工具
  showTools(category) {
    // 更新当前分类
    this.currentCategory = category;

    // 更新菜单项激活状态
    const menuItems = this.categoryMenu.querySelectorAll('li');
    menuItems.forEach(item => {
      if (
        (category === 'all' && item.getAttribute('data-category') === 'all') ||
        item.getAttribute('data-category') === category
      ) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // 清空工具网格
    this.toolsGrid.innerHTML = '';

    const { navigationData, categories } = this.dataManager.getCurrentData();

    // 显示所有分类或特定分类的工具
    if (category === 'all') {
      // 显示所有分类的工具
      categories.forEach(cat => {
        const tools = navigationData[cat] || [];
        tools.forEach(tool => this.addToolItem(tool));
      });
    } else {
      // 显示特定分类的工具
      const tools = navigationData[category] || [];
      tools.forEach(tool => this.addToolItem(tool));
    }
  }

  // 获取网站favicon的URL
  getFaviconUrl(url) {
    try {
      const safeUrl = this.getSafeUrl(url);
      if (!safeUrl) return null;

      const urlObj = new URL(safeUrl);
      const hostname = urlObj.hostname;

      // 检查内存缓存
      const cacheKey = `favicon_${hostname}`;
      if (this.faviconCache.has(cacheKey)) {
        return this.faviconCache.get(cacheKey);
      }

      // 检查LocalStorage缓存
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cacheData = JSON.parse(cached);
          // 检查缓存是否过期（24小时）
          if (Date.now() - cacheData.timestamp < 24 * 60 * 60 * 1000) {
            this.faviconCache.set(cacheKey, cacheData.url);
            return cacheData.url;
          }
        }
      } catch (e) {
        // 静默处理LocalStorage错误
      }

      // 通过同源代理获取favicon，避免浏览器直接向第三方暴露访问列表
      const faviconProxyUrl = new URL('/api/favicon', window.location.origin);
      faviconProxyUrl.searchParams.set('url', safeUrl);
      const faviconUrl = `${faviconProxyUrl.pathname}${faviconProxyUrl.search}`;

      // 预缓存到内存（使用Google服务）
      this.faviconCache.set(cacheKey, faviconUrl);

      // 异步缓存到LocalStorage（不阻塞主线程）
      setTimeout(() => {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            url: faviconUrl,
            timestamp: Date.now(),
            ttl: 24 * 60 * 60 * 1000 // 24小时
          }));
        } catch (e) {
          // 静默处理LocalStorage错误
        }
      }, 0);

      return faviconUrl;

    } catch (e) {
      // 静默处理URL错误，返回null使用文字图标
      return null;
    }
  }

  getSafeUrl(value) {
    let candidate = value;
    if (candidate && typeof candidate === 'object') {
      candidate = candidate.link || candidate.text || '';
    }

    if (typeof candidate !== 'string' || !candidate.trim()) return null;

    try {
      const parsed = new URL(candidate.trim());
      const supportedProtocol = ['http:', 'https:'].includes(parsed.protocol);
      return supportedProtocol && !parsed.username && !parsed.password ? parsed.href : null;
    } catch (error) {
      return null;
    }
  }

  // 生成文字图标
  createTextIcon(name) {
    // 获取名称的第一个字符（如果是中文）或前两个字符的首字母（如果是英文）
    let iconText = '';
    if (/[\u4e00-\u9fa5]/.test(name[0])) {
      // 中文名称，取第一个字
      iconText = name[0];
    } else {
      // 英文名称，取前两个单词的首字母
      const words = name.split(/\s+/);
      if (words.length >= 2) {
        iconText = (words[0][0] + words[1][0]).toUpperCase();
      } else if (words[0].length >= 2) {
        iconText = words[0].substring(0, 2).toUpperCase();
      } else {
        iconText = words[0][0].toUpperCase();
      }
    }

    // 检查当前主题模式
    const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

    // 生成随机背景色（柔和的颜色）
    const hue = Math.floor(Math.random() * 360);
    // 在亮色模式下使用更浅的背景色（亮度从80%提高到90%）
    const lightness = isDarkMode ? 80 : 90;
    const bgColor = `hsl(${hue}, 70%, ${lightness}%)`;
    const textColor = `hsl(${hue}, 70%, 30%)`;

    const textIcon = document.createElement('div');
    textIcon.className = 'text-icon';
    textIcon.style.backgroundColor = bgColor;
    textIcon.style.color = textColor;
    textIcon.textContent = iconText;
    return textIcon;
  }

  // 添加工具项
  addToolItem(tool) {
    const toolItem = document.createElement('div');
    toolItem.className = 'tool-item glass-container hover-lift click-bounce';
    toolItem.dataset.id = tool.id || '';

    // 创建链接元素
    const linkElement = document.createElement('a');
    const safeUrl = this.getSafeUrl(tool?.url);
    linkElement.href = safeUrl || '#';
    if (safeUrl) {
      linkElement.target = '_blank';
    } else {
      linkElement.setAttribute('aria-disabled', 'true');
      linkElement.addEventListener('click', event => event.preventDefault());
    }
    linkElement.rel = 'noopener noreferrer';
    if (tool && tool.name) {
      linkElement.title = tool.name;
    }

    // 使用图标（如果有）或尝试获取网站favicon或生成文字图标
    const name = typeof tool?.name === 'string' && tool.name.trim() ? tool.name.trim() : '未命名网站';
    const fallbackIcon = this.createTextIcon(name);
    let primaryIcon = null;

    if (tool.icon && typeof tool.icon === 'string' && tool.icon.trim()) {
      const safeIconUrl = this.getSafeUrl(tool.icon);
      if (safeIconUrl) {
        primaryIcon = document.createElement('img');
        primaryIcon.src = safeIconUrl;
        primaryIcon.alt = '';
        primaryIcon.className = 'tool-icon';
      } else if (/^bi-[a-z0-9-]+$/.test(tool.icon.trim())) {
        primaryIcon = document.createElement('i');
        primaryIcon.className = `bi ${tool.icon.trim()} tool-icon`;
        primaryIcon.setAttribute('aria-hidden', 'true');
      }
    }

    if (!primaryIcon) {
      // 尝试使用网站的favicon
      const faviconUrl = this.getFaviconUrl(tool.url);
      if (faviconUrl) {
        primaryIcon = document.createElement('img');
        primaryIcon.src = faviconUrl;
        primaryIcon.alt = '';
        primaryIcon.className = 'tool-icon';
      }
    }

    if (primaryIcon) {
      fallbackIcon.style.display = 'none';
      if (primaryIcon.tagName === 'IMG') {
        primaryIcon.addEventListener('error', () => {
          primaryIcon.style.display = 'none';
          fallbackIcon.style.display = 'flex';
        });
      }
      linkElement.appendChild(primaryIcon);
    }

    linkElement.appendChild(fallbackIcon);
    const nameElement = document.createElement('div');
    nameElement.className = 'tool-name';
    nameElement.textContent = name;
    linkElement.appendChild(nameElement);

    // 添加删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tool-item-delete-btn';
    const deleteIcon = document.createElement('i');
    deleteIcon.className = 'bi bi-trash';
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.title = '删除网站';
    deleteBtn.setAttribute('aria-label', `删除网站 ${name}`);
    deleteBtn.dataset.toolId = tool.id || '';
    deleteBtn.dataset.toolName = tool.name || '';

    // 添加点击事件
    deleteBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.linkManager) {
        window.linkManager.showDeleteConfirmation(tool.id || '', tool.name || '');
      }
    });

    // 组装工具项
    toolItem.appendChild(linkElement);
    toolItem.appendChild(deleteBtn);

    this.toolsGrid.appendChild(toolItem);
  }

  // 显示加载动画
  showLoadingAnimation() {
    if (!this.toolsGrid) return;

    this.toolsGrid.innerHTML = `
      <div class="loading-container" style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 300px;
        text-align: center;
      ">
        <div class="loading-spinner" style="
          width: 40px;
          height: 40px;
          border: 4px solid #f3f3f3;
          border-top: 4px solid #007bff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        "></div>
        <p style="color: #666; font-size: 16px; margin: 0;">正在加载导航数据...</p>
      </div>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    `;
  }

  // 隐藏加载动画
  hideLoadingAnimation() {
    if (!this.toolsGrid) return;

    const loadingContainer = this.toolsGrid.querySelector('.loading-container');
    if (loadingContainer) {
      loadingContainer.remove();
    }
  }

  // 显示错误信息
  showError(message) {
    if (!this.toolsGrid) return;

    this.toolsGrid.innerHTML = '';
    const errorContainer = document.createElement('div');
    errorContainer.style.cssText = 'text-align: center; width: 100%; padding: 30px;';
    const icon = document.createElement('i');
    icon.className = 'bi bi-exclamation-triangle';
    icon.style.cssText = 'font-size: 48px; color: #ff4d4f; margin-bottom: 20px;';
    const text = document.createElement('p');
    text.style.color = '#666';
    text.textContent = message;
    errorContainer.append(icon, text);
    this.toolsGrid.appendChild(errorContainer);
  }

  // 更新时间信息
  updateTimeInfo() {
    if (!this.currentTimeEl) return;

    const now = new Date();

    // 更新当前时间
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    this.currentTimeEl.textContent = `${hours}:${minutes}:${seconds}`;

    // 如果有缓存数据，使用缓存的日期信息
    const { dateInfo } = this.dataManager.getCurrentData();
    if (dateInfo) {
      this.updateDateInfo(dateInfo);
    } else {
      // 更新日期信息（使用静态值作为fallback）
      const month = now.getMonth() + 1;
      const date = now.getDate();
      const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      const weekday = weekdays[now.getDay()];

      if (this.dateInfoEl) {
        this.dateInfoEl.textContent = `${month} 月 ${date} 日 ${weekday}`;
      }
    }
  }

  // 更新日期信息
  updateDateInfo(dateInfo) {
    if (this.dateInfoEl && dateInfo) {
      this.dateInfoEl.textContent = `${dateInfo.date} ${dateInfo.weekday} ${dateInfo.lunarDate}`;
    }
  }

  // 立即更新时间信息
  updateTimeInfoImmediately() {
    if (this.currentTimeEl && this.dateInfoEl) {
      const now = new Date();

      // 更新当前时间
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      this.currentTimeEl.textContent = `${hours}:${minutes}:${seconds}`;

      // 更新日期信息
      const { dateInfo } = this.dataManager.getCurrentData();
      if (dateInfo) {
        this.dateInfoEl.textContent = `${dateInfo.date} ${dateInfo.weekday} ${dateInfo.lunarDate}`;
      } else {
        const month = now.getMonth() + 1;
        const date = now.getDate();
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const weekday = weekdays[now.getDay()];
        this.dateInfoEl.textContent = `${month} 月 ${date} 日 ${weekday}`;
      }
    }
  }

  // 刷新工具图标
  refreshToolIcons() {
    // 重新显示工具，这将重新生成图标
    this.showTools(this.currentCategory);
  }

  // 获取当前分类
  getCurrentCategory() {
    return this.currentCategory;
  }
}

// 导出UI渲染器
window.UIRenderer = UIRenderer;
