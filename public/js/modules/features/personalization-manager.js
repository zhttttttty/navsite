/**
 * 本地个性化：视图密度、常用网站和最近访问。
 * 所有数据只保存在当前浏览器，不写回飞书。
 */
class PersonalizationManager {
  constructor(dataManager, uiRenderer) {
    this.dataManager = dataManager;
    this.uiRenderer = uiRenderer;
    this.PINNED_KEY = 'navsite_pinned_sites';
    this.RECENT_KEY = 'navsite_recent_sites';
    this.VIEW_KEY = 'navsite_view_mode';
    this.pinnedKeys = this.readArray(this.PINNED_KEY);
    this.recentEntries = this.readArray(this.RECENT_KEY);
    this.viewMode = localStorage.getItem(this.VIEW_KEY) === 'compact' ? 'compact' : 'default';
    this.viewToggle = document.getElementById('view-mode-toggle');
  }

  init() {
    this.uiRenderer.personalizationManager = this;
    this.applyViewMode();

    if (this.viewToggle) {
      this.viewToggle.addEventListener('click', () => {
        this.viewMode = this.viewMode === 'compact' ? 'default' : 'compact';
        this.writeValue(this.VIEW_KEY, this.viewMode);
        this.applyViewMode();
      });
    }
  }

  readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.warn(`读取本地个性化数据失败: ${key}`, error);
      return [];
    }
  }

  writeValue(key, value) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch (error) {
      console.warn(`保存本地个性化数据失败: ${key}`, error);
    }
  }

  applyViewMode() {
    document.body.dataset.viewMode = this.viewMode;
    if (!this.viewToggle) return;

    const compact = this.viewMode === 'compact';
    this.viewToggle.setAttribute('aria-pressed', String(compact));
    this.viewToggle.title = compact ? '切换到默认视图' : '切换到紧凑视图';
    const label = this.viewToggle.querySelector('span');
    if (label) label.textContent = compact ? '默认' : '紧凑';
    const icon = this.viewToggle.querySelector('i');
    if (icon) icon.className = compact ? 'bi bi-grid-3x3-gap' : 'bi bi-grid';
  }

  getToolKey(tool) {
    if (tool?.id) return `id:${tool.id}`;
    return `url:${String(tool?.url || '').trim().toLocaleLowerCase()}`;
  }

  isPinned(tool) {
    return this.pinnedKeys.includes(this.getToolKey(tool));
  }

  togglePin(tool) {
    const key = this.getToolKey(tool);
    if (!key || key === 'url:') return;

    if (this.pinnedKeys.includes(key)) {
      this.pinnedKeys = this.pinnedKeys.filter(item => item !== key);
    } else {
      this.pinnedKeys = [key, ...this.pinnedKeys].slice(0, 24);
    }
    this.writeValue(this.PINNED_KEY, this.pinnedKeys);
    this.uiRenderer.renderTools();
  }

  recordVisit(tool, refreshView = false) {
    const key = this.getToolKey(tool);
    if (!key || key === 'url:') return;

    this.recentEntries = [
      { key, openedAt: Date.now() },
      ...this.recentEntries.filter(entry => entry?.key !== key)
    ].slice(0, 12);
    this.writeValue(this.RECENT_KEY, this.recentEntries);
    if (refreshView && this.uiRenderer.getCurrentCategory() === 'all') {
      setTimeout(() => this.uiRenderer.renderTools(), 0);
    }
  }

  getAllTools() {
    const { navigationData, categories } = this.dataManager.getCurrentData();
    return categories.flatMap(category => {
      return (navigationData[category] || []).map(tool => ({ tool, category }));
    });
  }

  getPersonalSections() {
    const entries = this.getAllTools();
    const byKey = new Map(entries.map(entry => [this.getToolKey(entry.tool), entry]));
    const pinned = this.pinnedKeys.map(key => byKey.get(key)).filter(Boolean);
    const pinnedSet = new Set(pinned.map(entry => this.getToolKey(entry.tool)));
    const recent = this.recentEntries
      .slice()
      .sort((a, b) => Number(b?.openedAt || 0) - Number(a?.openedAt || 0))
      .map(entry => byKey.get(entry?.key))
      .filter(entry => entry && !pinnedSet.has(this.getToolKey(entry.tool)))
      .slice(0, 8);

    return [
      { key: 'pinned', title: '我的常用', icon: 'bi-star-fill', entries: pinned },
      { key: 'recent', title: '最近访问', icon: 'bi-clock-history', entries: recent }
    ].filter(section => section.entries.length);
  }
}

window.PersonalizationManager = PersonalizationManager;
