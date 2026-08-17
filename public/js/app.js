/**
 * 主应用程序 - 重构后的模块化版本
 * 负责加载所有模块并初始化应用程序
 */

// 加载模块脚本
function loadModules() {
  const modules = [
    // 核心模块
    '/js/modules/core/pwa-manager.js',
    '/js/modules/core/theme-manager.js', 
    '/js/modules/core/data-manager.js',
    '/js/modules/core/ui-renderer.js',
    
    // 功能模块
    '/js/modules/features/command-palette.js',
    '/js/modules/features/link-manager.js',
    '/js/modules/features/interaction-manager.js',
    '/js/modules/features/personalization-manager.js',
    
    // 工具模块
    '/js/modules/utils/common-utils.js'
  ];

  return Promise.all(
    modules.map(src => {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    })
  );
}

// 全局变量
let dataManager = null;
let uiRenderer = null;
let themeManager = null;
let pwaManager = null;
let linkManager = null;
let interactionManager = null;
let personalizationManager = null;
let commandPalette = null;

function bindNavigationAvatarFallbacks() {
  document.querySelectorAll('[data-navigation-avatar]').forEach(avatar => {
    const showFallback = () => {
      const fallbackSrc = avatar.dataset.fallbackSrc;
      avatar.classList.remove('is-random-avatar');
      if (fallbackSrc && avatar.getAttribute('src') !== fallbackSrc) {
        avatar.src = fallbackSrc;
      }
    };

    avatar.addEventListener('error', showFallback, { once: true });
    if (avatar.complete && avatar.naturalWidth === 0) showFallback();
  });
}

bindNavigationAvatarFallbacks();

// 初始化应用程序
async function initApp() {
  try {
    // 显示页面加载动画
    window.utils.showPageLoader();
    
    // 初始化核心模块
    await initCoreModules();
    
    // 初始化功能模块
    await initFeatureModules();
    
    // 初始化交互管理器
    interactionManager = new window.InteractionManager();
    window.interactionManager = interactionManager;
    
    // 获取并显示数据
    await loadAndDisplayData();
    
    // 绑定事件监听器
    bindEventListeners();
    
    // 延迟隐藏页面加载动画，确保动画效果完整
    setTimeout(() => {
      window.utils.hidePageLoader();
      
      // 确保图标背景色正确设置
      if (window.themeInitialized) {
        window.utils.refreshToolIcons();
      }
      
    }, 800);
    
  } catch (error) {
    console.error('初始化失败:', error);
    handleInitError(error);
  }
}

// 初始化核心模块
async function initCoreModules() {
  // 初始化PWA管理器
  pwaManager = new window.PWAManager();
  
  // 初始化主题管理器
  themeManager = new window.ThemeManager();
  window.themeManager = themeManager; // 设置全局引用
  
  // 初始化数据管理器
  dataManager = new window.DataManager();
  window.dataManager = dataManager; // 设置全局引用
  
  // 初始化UI渲染器
  uiRenderer = new window.UIRenderer(dataManager);
  window.uiRenderer = uiRenderer; // 设置全局引用
  
  // 立即更新时间信息
  uiRenderer.updateTimeInfoImmediately();
  
  // 开始定时更新时间
  setInterval(() => uiRenderer.updateTimeInfo(), 1000);
}

// 初始化功能模块
async function initFeatureModules() {
  // 初始化链接管理器
  linkManager = new window.LinkManager(dataManager);
  window.linkManager = linkManager; // 设置全局引用

  personalizationManager = new window.PersonalizationManager(dataManager, uiRenderer);
  personalizationManager.init();
  window.personalizationManager = personalizationManager;

  commandPalette = new window.CommandPalette(dataManager, uiRenderer, personalizationManager);
  commandPalette.init();
  window.commandPalette = commandPalette;
}

// 加载并显示数据
async function loadAndDisplayData() {
  // 显示加载动画
  uiRenderer.showLoadingAnimation();
  
  try {
    const result = await dataManager.fetchNavigationData();
    
    if (result.success) {
      // 隐藏加载动画
      uiRenderer.hideLoadingAnimation();
      
      // 生成分类菜单
      uiRenderer.generateCategoryMenu();
      
      // 显示所有工具
      uiRenderer.showTools('all');
      
      // 更新日期信息
      if (result.dateInfo) {
        uiRenderer.updateDateInfo(result.dateInfo);
      }
    } else {
      uiRenderer.hideLoadingAnimation();
      uiRenderer.showError('加载数据失败，请稍后重试');
    }
  } catch (error) {
    console.error('加载数据异常:', error);
    uiRenderer.hideLoadingAnimation();
    uiRenderer.showError('网络错误，请检查网络连接');
  }
}

// 绑定事件监听器
function bindEventListeners() {
  // 主页菜单项点击事件
  const homeMenuItem = document.querySelector('[data-category="all"]');
  if (homeMenuItem) {
    homeMenuItem.addEventListener('click', () => {
      uiRenderer.showTools('all');
      if (window.innerWidth <= 768) interactionManager.closeMobileMenu();
    });
    homeMenuItem.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        uiRenderer.showTools('all');
      }
    });
  }

  // 数据变更事件监听器
  window.addEventListener('dataChanged', async () => {
    console.log('数据发生变更，重新加载...');
    await loadAndDisplayData();
  });

  window.addEventListener('navigationRefreshed', event => {
    uiRenderer.generateCategoryMenu();
    uiRenderer.showTools(uiRenderer.getCurrentCategory());
    if (event.detail?.dateInfo) uiRenderer.updateDateInfo(event.detail.dateInfo);
  });

  bindSearchControls();
  bindManageMode();
}

function bindSearchControls() {
  const input = document.getElementById('site-search-input');
  const engineSelect = document.getElementById('search-engine');
  const webSearchButton = document.getElementById('web-search-btn');
  if (!input || !engineSelect || !webSearchButton) return;

  const savedEngine = localStorage.getItem('navsite_search_engine');
  const engineNames = ['bing', 'baidu', 'google', 'github', 'bilibili'];
  if (engineNames.includes(savedEngine)) {
    engineSelect.value = savedEngine;
  }

  const searchUrls = {
    bing: 'https://www.bing.com/search?q=',
    baidu: 'https://www.baidu.com/s?wd=',
    google: 'https://www.google.com/search?q=',
    github: 'https://github.com/search?q=',
    bilibili: 'https://search.bilibili.com/all?keyword='
  };

  const searchWeb = () => {
    const query = input.value.trim();
    if (!query) {
      input.focus();
      return;
    }
    const searchUrl = searchUrls[engineSelect.value] || searchUrls.bing;
    window.open(`${searchUrl}${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer');
  };

  input.addEventListener('input', () => uiRenderer.setSearchQuery(input.value));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.ctrlKey) searchWeb();
    if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const currentIndex = engineNames.indexOf(engineSelect.value);
      engineSelect.value = engineNames[(currentIndex + offset + engineNames.length) % engineNames.length];
      localStorage.setItem('navsite_search_engine', engineSelect.value);
    }
  });
  engineSelect.addEventListener('change', () => {
    localStorage.setItem('navsite_search_engine', engineSelect.value);
  });
  webSearchButton.addEventListener('click', searchWeb);

}

function bindManageMode() {
  const button = document.getElementById('manage-links-btn');
  if (!button) return;

  button.addEventListener('click', () => {
    const enabled = document.body.classList.toggle('edit-mode');
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? '完成' : '管理';
  });
}

// 处理初始化错误
function handleInitError(error) {
  const toolsGrid = document.getElementById('tools-grid');
  if (toolsGrid) {
    toolsGrid.innerHTML = '';
    const container = document.createElement('div');
    container.style.cssText = 'text-align: center; padding: 40px; color: #666;';
    const icon = document.createElement('i');
    icon.className = 'bi bi-exclamation-triangle';
    icon.style.cssText = 'font-size: 48px; margin-bottom: 20px; color: #ff4d4f;';
    const title = document.createElement('h3');
    title.textContent = '页面加载失败';
    const message = document.createElement('p');
    message.textContent = '请刷新页面重试';
    const reloadButton = document.createElement('button');
    reloadButton.textContent = '刷新页面';
    reloadButton.style.cssText = 'margin-top: 20px; padding: 10px 20px; background: #1677ff; color: white; border: none; border-radius: 6px; cursor: pointer;';
    reloadButton.addEventListener('click', () => location.reload());
    container.append(icon, title, message, reloadButton);
    toolsGrid.appendChild(container);
  }
}

// 初始化性能监控和错误处理
function initGlobalFeatures() {
  window.utils.initPerformanceMonitoring();
  window.utils.initErrorHandling();
}

// 兼容性函数 - 保持向后兼容
window.refreshToolIcons = function() {
  if (window.uiRenderer) {
    window.uiRenderer.refreshToolIcons();
  }
};

window.toggleTheme = function() {
  if (window.themeManager) {
    window.themeManager.toggleMode();
  }
};

// 在DOM加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await loadModules();
    initGlobalFeatures();
    await initApp();
  });
} else {
  // DOM已经加载完成
  loadModules().then(() => {
    initGlobalFeatures();
    initApp();
  });
}
