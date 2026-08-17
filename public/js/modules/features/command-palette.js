/**
 * 轻量命令搜索面板：复用导航数据和站内搜索规则，支持完整键盘操作。
 */
class CommandPalette {
  constructor(dataManager, uiRenderer, personalizationManager) {
    this.dataManager = dataManager;
    this.uiRenderer = uiRenderer;
    this.personalizationManager = personalizationManager;
    this.container = document.getElementById('command-palette');
    this.input = document.getElementById('command-palette-input');
    this.resultsElement = document.getElementById('command-palette-results');
    this.emptyElement = document.getElementById('command-palette-empty');
    this.closeButton = document.getElementById('command-palette-close');
    this.activeIndex = 0;
    this.results = [];
  }

  init() {
    if (!this.container || !this.input || !this.resultsElement || !this.emptyElement) return;

    this.input.addEventListener('input', () => this.renderResults());
    this.resultsElement.addEventListener('click', event => {
      const button = event.target.closest('[data-result-index]');
      if (!button) return;
      this.openResult(Number(button.dataset.resultIndex));
    });
    this.closeButton?.addEventListener('click', () => this.close());
    this.container.addEventListener('click', event => {
      if (event.target === this.container) this.close();
    });

    document.addEventListener('keydown', event => this.handleGlobalKeydown(event));
  }

  isOpen() {
    return !this.container.hidden;
  }

  isEditableTarget(target) {
    return target instanceof HTMLElement && (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
    );
  }

  handleGlobalKeydown(event) {
    const commandShortcut = (event.ctrlKey || event.metaKey)
      && event.key.toLocaleLowerCase() === 'k';
    const slashShortcut = event.key === '/'
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && !this.isEditableTarget(event.target);

    if ((commandShortcut || slashShortcut) && !document.querySelector('.modal.active')) {
      event.preventDefault();
      this.open();
      return;
    }

    if (!this.isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.openResult(this.activeIndex);
    }
  }

  open() {
    const pageSearch = document.getElementById('site-search-input');
    this.container.hidden = false;
    document.body.classList.add('command-palette-open');
    this.input.value = pageSearch?.value?.trim() || '';
    this.activeIndex = 0;
    this.renderResults();
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.select();
    });
  }

  close() {
    this.container.hidden = true;
    document.body.classList.remove('command-palette-open');
  }

  getCandidates() {
    const { navigationData, categories } = this.dataManager.getCurrentData();
    return categories.flatMap(category => {
      return (navigationData[category] || []).map(tool => ({ tool, category }));
    });
  }

  renderResults() {
    const query = this.input.value.trim();
    this.results = this.getCandidates()
      .filter(entry => this.uiRenderer.matchesQuery(entry.tool, entry.category, query))
      .slice(0, 12);
    this.activeIndex = Math.min(this.activeIndex, Math.max(this.results.length - 1, 0));
    this.resultsElement.replaceChildren();

    this.results.forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-result';
      button.dataset.resultIndex = String(index);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === this.activeIndex));

      const icon = this.uiRenderer.createTextIcon(entry.tool?.name || '?');
      icon.classList.add('command-result-icon');
      const copy = document.createElement('span');
      copy.className = 'command-result-copy';
      const title = document.createElement('strong');
      title.textContent = entry.tool?.name || '未命名网站';
      const meta = document.createElement('small');
      meta.textContent = `${entry.category} · ${this.getHostname(entry.tool?.url)}`;
      copy.append(title, meta);
      const action = document.createElement('kbd');
      action.textContent = index === this.activeIndex ? 'Enter' : '↗';
      button.append(icon, copy, action);
      this.resultsElement.appendChild(button);
    });

    this.emptyElement.hidden = this.results.length > 0;
    this.updateSelection();
  }

  getHostname(value) {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch (error) {
      return '未知域名';
    }
  }

  moveSelection(offset) {
    if (!this.results.length) return;
    this.activeIndex = (this.activeIndex + offset + this.results.length) % this.results.length;
    this.updateSelection();
  }

  updateSelection() {
    const buttons = [...this.resultsElement.querySelectorAll('[data-result-index]')];
    buttons.forEach((button, index) => {
      const active = index === this.activeIndex;
      button.setAttribute('aria-selected', String(active));
      const action = button.querySelector('kbd');
      if (action) action.textContent = active ? 'Enter' : '↗';
      if (active) button.scrollIntoView({ block: 'nearest' });
    });
  }

  openResult(index) {
    const entry = this.results[index];
    const safeUrl = this.uiRenderer.getSafeUrl(entry?.tool?.url);
    if (!entry || !safeUrl) return;

    this.personalizationManager?.recordVisit(entry.tool, true);
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
    this.close();
  }
}

window.CommandPalette = CommandPalette;
