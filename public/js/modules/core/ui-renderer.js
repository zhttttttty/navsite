/**
 * UI渲染器 - 处理DOM元素渲染、工具项生成、分类菜单等
 */
class UIRenderer {
  constructor(dataManager, networkManager = null) {
    this.dataManager = dataManager;
    this.networkManager = networkManager;
    this.currentCategory = 'all';
    this.searchQuery = '';
    this.faviconCache = new Map();
    this.personalizationManager = null;
    this.scrollObserver = null;

    // DOM元素引用
    this.categoryMenu = document.getElementById('category-menu');
    this.toolsGrid = document.getElementById('tools-grid');
    this.currentTimeEl = document.getElementById('current-time');
    this.dateInfoEl = document.getElementById('date-info');
  }

  // 生成分类菜单
  generateCategoryMenu() {
    if (!this.categoryMenu) return;

    const { navigationData, categories } = this.dataManager.getCurrentData();

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
      const badge = document.createElement('span');
      badge.className = 'category-menu-badge';
      badge.textContent = String((navigationData[category] || []).length);
      badge.setAttribute('aria-label', `${(navigationData[category] || []).length} 个网站`);
      li.appendChild(badge);
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.addEventListener('click', () => {
        this.navigateToCategory(category);
        if (window.innerWidth <= 768 && window.interactionManager) {
          window.interactionManager.closeMobileMenu();
        }
      });
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.navigateToCategory(category);
        }
      });
      this.categoryMenu.appendChild(li);
    });

    this.updateDashboardSummary();
  }

  updateDashboardSummary() {
    const { navigationData, categories } = this.dataManager.getCurrentData();
    const siteCount = categories.reduce((total, category) => {
      return total + (Array.isArray(navigationData[category]) ? navigationData[category].length : 0);
    }, 0);
    const siteCountElement = document.getElementById('site-count');
    const categoryCountElement = document.getElementById('category-count');
    if (siteCountElement) siteCountElement.textContent = String(siteCount);
    if (categoryCountElement) categoryCountElement.textContent = String(categories.length);
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

    this.renderTools();
  }

  setActiveMenuCategory(category) {
    if (!this.categoryMenu) return;
    this.categoryMenu.querySelectorAll('li').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-category') === category);
    });
  }

  navigateToCategory(category) {
    if (this.currentCategory !== 'all') this.showTools('all');
    requestAnimationFrame(() => {
      const section = [...this.toolsGrid.querySelectorAll('.category-section')]
        .find(item => item.dataset.category === category);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.setActiveMenuCategory(category);
      } else {
        this.showTools(category);
      }
    });
  }

  initScrollSpy() {
    this.scrollObserver?.disconnect();
    this.scrollObserver = null;
    if (this.currentCategory !== 'all' || !('IntersectionObserver' in window)) return;

    const sections = [...this.toolsGrid.querySelectorAll('.category-section[data-category]')]
      .filter(section => !section.classList.contains('personal-section'));
    if (!sections.length) return;

    this.scrollObserver = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target?.dataset?.category) {
        this.setActiveMenuCategory(visible.target.dataset.category);
      }
    }, { rootMargin: '-16% 0px -62% 0px', threshold: [0.05, 0.25, 0.6] });

    sections.forEach(section => this.scrollObserver.observe(section));
  }

  setSearchQuery(value) {
    this.searchQuery = typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
    this.renderTools();
  }

  toolMatchesSearch(tool, category) {
    return this.matchesQuery(tool, category, this.searchQuery);
  }

  matchesQuery(tool, category, value) {
    const query = typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
    if (!query) return true;
    const searchable = [tool?.name, tool?.url, tool?.lanUrl, category]
      .filter(value => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase();
    if (searchable.includes(query)) return true;

    if (window.PinyinMatch && typeof tool?.name === 'string' && /^[a-z\s]+$/i.test(query)) {
      try {
        return window.PinyinMatch.match(tool.name, query) !== false;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  renderTools() {
    if (!this.toolsGrid) return;

    this.toolsGrid.innerHTML = '';
    this.toolsGrid.classList.toggle('grouped-view', this.currentCategory === 'all');
    const { navigationData, categories } = this.dataManager.getCurrentData();
    let visibleCount = 0;

    if (this.currentCategory === 'all') {
      if (!this.searchQuery && this.personalizationManager) {
        this.personalizationManager.getPersonalSections().forEach(personalSection => {
          const section = document.createElement('section');
          section.className = 'category-section personal-section';
          section.dataset.personalSection = personalSection.key;
          const heading = document.createElement('div');
          heading.className = 'category-heading';
          const icon = document.createElement('i');
          icon.className = `bi ${personalSection.icon}`;
          icon.setAttribute('aria-hidden', 'true');
          const title = document.createElement('h2');
          title.textContent = personalSection.title;
          const count = document.createElement('span');
          count.textContent = String(personalSection.entries.length);
          heading.append(icon, title, count);
          const grid = document.createElement('div');
          grid.className = 'category-tools-grid personal-tools-grid';
          personalSection.entries.forEach(entry => this.addToolItem(entry.tool, grid, entry.category));
          section.append(heading, grid);
          this.toolsGrid.appendChild(section);
        });
      }

      categories.forEach(category => {
        const tools = (navigationData[category] || [])
          .filter(tool => this.toolMatchesSearch(tool, category));
        if (!tools.length) return;

        const section = document.createElement('section');
        section.className = 'category-section';
        section.dataset.category = category;
        const heading = document.createElement('div');
        heading.className = 'category-heading';
        const title = document.createElement('h2');
        title.textContent = category;
        const count = document.createElement('span');
        count.textContent = String(tools.length);
        count.setAttribute('aria-label', `${tools.length} 个网站`);
        heading.append(title, count);

        const grid = document.createElement('div');
        grid.className = 'category-tools-grid';
        tools.forEach(tool => this.addToolItem(tool, grid, category));
        visibleCount += tools.length;
        section.append(heading, grid);
        this.toolsGrid.appendChild(section);
      });
    } else {
      const tools = (navigationData[this.currentCategory] || [])
        .filter(tool => this.toolMatchesSearch(tool, this.currentCategory));
      tools.forEach(tool => this.addToolItem(tool, this.toolsGrid, this.currentCategory));
      visibleCount = tools.length;
    }

    if (!visibleCount) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      const title = document.createElement('strong');
      title.textContent = this.searchQuery ? '没有找到匹配的网站' : '这个分类还没有网站';
      const hint = document.createElement('span');
      hint.textContent = this.searchQuery ? '换个关键词，或使用右侧按钮搜索网络' : '点击右下角按钮添加第一个网站';
      emptyState.append(title, hint);
      this.toolsGrid.appendChild(emptyState);
    }

    if (this.currentCategory === 'all') {
      requestAnimationFrame(() => this.initScrollSpy());
    } else {
      this.scrollObserver?.disconnect();
    }
  }

  // 获取网站favicon的URL
  getFaviconUrl(url, refresh = false) {
    try {
      const safeUrl = this.getSafeUrl(url);
      if (!safeUrl) return null;

      const urlObj = new URL(safeUrl);
      const hostname = urlObj.hostname;

      // 检查内存缓存
      const cacheKey = `favicon_v3_${urlObj.origin}`;
      if (!refresh && this.faviconCache.has(cacheKey)) {
        return this.faviconCache.get(cacheKey);
      }

      // 通过同源代理获取favicon，避免浏览器直接向第三方暴露访问列表
      const faviconProxyUrl = new URL('/api/favicon', window.location.origin);
      faviconProxyUrl.searchParams.set('url', safeUrl);
      faviconProxyUrl.searchParams.set('size', '64');
      if (refresh) faviconProxyUrl.searchParams.set('refresh', String(Date.now()));
      const faviconUrl = `${faviconProxyUrl.pathname}${faviconProxyUrl.search}`;

      this.faviconCache.set(cacheKey, faviconUrl);
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

  getSafeAssetUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const parsed = new URL(value.trim(), window.location.origin);
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

    const hue = this.getDeterministicHue(name);
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

  getDeterministicHue(value) {
    return [...String(value || '?')].reduce((hash, character) => {
      return ((hash * 31) + character.codePointAt(0)) % 360;
    }, 17);
  }

  getDisplayHostname(value) {
    const safeUrl = this.getSafeUrl(value);
    if (!safeUrl) return '';

    try {
      return new URL(safeUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  // 添加工具项
  addToolItem(tool, target = this.toolsGrid, category = '') {
    const toolItem = document.createElement('div');
    toolItem.className = 'tool-item glass-container hover-lift click-bounce';
    toolItem.dataset.id = tool.id || '';
    toolItem.style.setProperty('--tool-hue', String(this.getDeterministicHue(tool?.url || tool?.name)));

    // 创建链接元素
    const linkElement = document.createElement('a');
    const safeUrl = this.networkManager?.resolveToolUrl(tool)
      || this.getSafeUrl(tool?.url)
      || this.getSafeUrl(tool?.lanUrl);
    linkElement.href = safeUrl || '#';
    if (safeUrl) {
      linkElement.target = '_blank';
    } else {
      linkElement.setAttribute('aria-disabled', 'true');
      linkElement.addEventListener('click', event => event.preventDefault());
    }
    linkElement.rel = 'noopener noreferrer';
    linkElement.addEventListener('click', () => {
      this.personalizationManager?.recordVisit(tool, true);
    });
    if (tool && tool.name) {
      linkElement.title = tool.name;
    }

    // 使用图标（如果有）或尝试获取网站favicon或生成文字图标
    const name = typeof tool?.name === 'string' && tool.name.trim() ? tool.name.trim() : '未命名网站';
    const fallbackIcon = this.createTextIcon(name);
    let primaryIcon = null;
    const faviconTargets = [...new Set([
      this.getSafeUrl(tool?.lanUrl),
      this.getSafeUrl(tool?.url)
    ].filter(Boolean))];
    const fallbackIconUrls = faviconTargets.map(targetUrl => this.getFaviconUrl(targetUrl)).filter(Boolean);

    if (tool.icon && typeof tool.icon === 'string' && tool.icon.trim()) {
      const safeIconUrl = this.getSafeAssetUrl(tool.icon);
      if (safeIconUrl) {
        primaryIcon = document.createElement('img');
        primaryIcon.src = safeIconUrl;
        primaryIcon.alt = '';
        primaryIcon.className = 'tool-icon';
      }
    }

    if (!primaryIcon) {
      // 尝试使用网站的favicon
      const faviconUrl = fallbackIconUrls.shift() || this.getFaviconUrl(safeUrl);
      if (faviconUrl) {
        primaryIcon = document.createElement('img');
        primaryIcon.src = faviconUrl;
        primaryIcon.alt = '';
        primaryIcon.className = 'tool-icon';
      }
    }

    const iconShell = document.createElement('span');
    iconShell.className = 'tool-icon-shell';
    if (primaryIcon) {
      fallbackIcon.style.display = 'none';
      if (primaryIcon.tagName === 'IMG') {
        primaryIcon.loading = 'lazy';
        primaryIcon.decoding = 'async';
        primaryIcon.referrerPolicy = 'no-referrer';
        const showFallback = () => {
          const nextIconUrl = fallbackIconUrls.shift();
          if (nextIconUrl) {
            primaryIcon.src = nextIconUrl;
            return;
          }
          primaryIcon.style.display = 'none';
          fallbackIcon.style.display = 'flex';
          iconShell.classList.add('is-fallback');
        };
        primaryIcon.addEventListener('error', showFallback);
        primaryIcon.addEventListener('load', () => {
          if (primaryIcon.naturalWidth <= 1 || primaryIcon.naturalHeight <= 1) {
            showFallback();
          } else {
            iconShell.classList.add('is-ready');
          }
        });
      }
      iconShell.appendChild(primaryIcon);
    }

    iconShell.appendChild(fallbackIcon);
    linkElement.appendChild(iconShell);

    const copyElement = document.createElement('span');
    copyElement.className = 'tool-copy';
    const nameElement = document.createElement('div');
    nameElement.className = 'tool-name';
    nameElement.textContent = name;
    copyElement.appendChild(nameElement);

    const hostname = this.getDisplayHostname(safeUrl);
    if (hostname) {
      const domainElement = document.createElement('span');
      domainElement.className = 'tool-domain';
      const isUsingLan = Boolean(tool?.lanUrl && safeUrl === this.getSafeUrl(tool.lanUrl));
      domainElement.textContent = `${isUsingLan ? '内网 · ' : ''}${hostname}`;
      copyElement.appendChild(domainElement);
    }

    const openIndicator = document.createElement('i');
    openIndicator.className = 'bi bi-arrow-up-right tool-open-indicator';
    openIndicator.setAttribute('aria-hidden', 'true');
    linkElement.append(copyElement, openIndicator);

    let pinBtn = null;
    if (this.personalizationManager) {
      pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'tool-item-pin-btn';
      const pinned = this.personalizationManager.isPinned(tool);
      pinBtn.classList.toggle('is-pinned', pinned);
      pinBtn.setAttribute('aria-pressed', String(pinned));
      pinBtn.setAttribute('aria-label', `${pinned ? '取消常用' : '加入常用'} ${name}`);
      pinBtn.title = pinned ? '取消常用' : '加入常用';
      const pinIcon = document.createElement('i');
      pinIcon.className = pinned ? 'bi bi-star-fill' : 'bi bi-star';
      pinIcon.setAttribute('aria-hidden', 'true');
      pinBtn.appendChild(pinIcon);
      pinBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.personalizationManager.togglePin(tool);
      });
    }

    // 添加删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tool-item-delete-btn';
    const deleteIcon = document.createElement('i');
    deleteIcon.className = 'bi bi-trash3';
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

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'tool-item-refresh-btn';
    const refreshIcon = document.createElement('i');
    refreshIcon.className = 'bi bi-arrow-clockwise';
    refreshIcon.setAttribute('aria-hidden', 'true');
    refreshBtn.appendChild(refreshIcon);
    refreshBtn.title = '重新抓取图标';
    refreshBtn.setAttribute('aria-label', `重新抓取 ${name} 的图标`);
    refreshBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const image = iconShell.querySelector('img');
      const refreshedUrl = this.getFaviconUrl(tool.url, true);
      if (!image || !refreshedUrl) return;
      fallbackIcon.style.display = 'none';
      image.style.display = 'block';
      iconShell.classList.remove('is-fallback', 'is-ready');
      image.src = refreshedUrl;
    });

    toolItem.appendChild(linkElement);
    if (pinBtn) toolItem.appendChild(pinBtn);
    toolItem.appendChild(refreshBtn);
    toolItem.appendChild(deleteBtn);

    target.appendChild(toolItem);
  }

  // 显示加载动画
  showLoadingAnimation() {
    if (!this.toolsGrid) return;

    this.toolsGrid.replaceChildren();
    this.toolsGrid.classList.remove('grouped-view');
    const skeletonGrid = document.createElement('div');
    skeletonGrid.className = 'skeleton-grid';
    skeletonGrid.setAttribute('aria-label', '正在加载导航数据');
    skeletonGrid.setAttribute('aria-busy', 'true');
    for (let index = 0; index < 8; index += 1) {
      const card = document.createElement('div');
      card.className = 'skeleton-card';
      const icon = document.createElement('span');
      icon.className = 'skeleton-icon';
      const line = document.createElement('span');
      line.className = 'skeleton-line';
      card.append(icon, line);
      skeletonGrid.appendChild(card);
    }
    this.toolsGrid.appendChild(skeletonGrid);
  }

  // 隐藏加载动画
  hideLoadingAnimation() {
    if (!this.toolsGrid) return;

    const loadingContainer = this.toolsGrid.querySelector('.skeleton-grid');
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
