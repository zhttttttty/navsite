/**
 * 网络模式管理器：自动识别访问环境，并允许用户手动固定内网或外网。
 */
class NetworkManager {
  constructor() {
    this.storageKey = 'navsite_network_mode';
    this.modeOrder = ['auto', 'lan', 'wan'];
    const savedMode = localStorage.getItem(this.storageKey);
    this.mode = this.modeOrder.includes(savedMode) ? savedMode : 'auto';
    this.detectedIsLan = false;
    this.detectionReason = 'not_checked';
    this.button = document.getElementById('network-mode-toggle');
  }

  async init() {
    this.bindControl();
    this.updateControl();
    try {
      const response = await fetch('/api/network-status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`network status ${response.status}`);
      const result = await response.json();
      if (!result.success) throw new Error('invalid network status');
      this.detectedIsLan = Boolean(result.isLan);
      this.detectionReason = result.reason || 'unknown';
    } catch (error) {
      this.detectedIsLan = this.isPrivateHostname(window.location.hostname);
      this.detectionReason = this.detectedIsLan ? 'private_hostname' : 'status_unavailable';
    }
    this.updateControl();
  }

  bindControl() {
    if (!this.button) return;
    this.button.addEventListener('click', () => {
      const index = this.modeOrder.indexOf(this.mode);
      this.mode = this.modeOrder[(index + 1) % this.modeOrder.length];
      localStorage.setItem(this.storageKey, this.mode);
      this.updateControl();
      window.dispatchEvent(new CustomEvent('networkModeChanged', {
        detail: { mode: this.mode, isLan: this.isLan() }
      }));
    });
  }

  isPrivateHostname(hostname) {
    const value = String(hostname || '').toLowerCase();
    return value === 'localhost'
      || value.endsWith('.local')
      || /^127\./.test(value)
      || /^10\./.test(value)
      || /^192\.168\./.test(value)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(value)
      || /^100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./.test(value)
      || value === '::1'
      || /^(fc|fd|fe[89ab])/i.test(value);
  }

  isLan() {
    if (this.mode === 'lan') return true;
    if (this.mode === 'wan') return false;
    return this.detectedIsLan;
  }

  getSafeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const parsed = new URL(value.trim());
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.href
        : null;
    } catch (error) {
      return null;
    }
  }

  resolveToolUrl(tool) {
    const wanUrl = this.getSafeUrl(tool?.url);
    const lanUrl = this.getSafeUrl(tool?.lanUrl);
    return this.isLan() ? (lanUrl || wanUrl) : (wanUrl || lanUrl);
  }

  updateControl() {
    if (!this.button) return;
    const effectiveIsLan = this.isLan();
    const labels = {
      auto: `自动 · ${effectiveIsLan ? '内网' : '外网'}`,
      lan: '固定内网',
      wan: '固定外网'
    };
    const icons = { auto: 'bi-router', lan: 'bi-house-door', wan: 'bi-globe2' };
    const icon = this.button.querySelector('i');
    const label = this.button.querySelector('span');
    if (icon) icon.className = `bi ${icons[this.mode]}`;
    if (label) label.textContent = labels[this.mode];
    this.button.dataset.mode = this.mode;
    this.button.dataset.network = effectiveIsLan ? 'lan' : 'wan';
    this.button.setAttribute('aria-label', `网络模式：${labels[this.mode]}，点击切换`);
    this.button.title = `当前${effectiveIsLan ? '内网' : '外网'}路由；点击依次切换自动、固定内网、固定外网`;
  }
}

window.NetworkManager = NetworkManager;
