const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');

test('manifest references existing correctly sized PNG icons', async () => {
  const manifestPath = path.join(projectRoot, 'public', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.id, '/');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));

  for (const icon of manifest.icons) {
    const iconPath = path.join(projectRoot, 'public', icon.src);
    assert.equal(fs.existsSync(iconPath), true, `${icon.src} must exist`);
    const metadata = await sharp(iconPath).metadata();
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
  }

  for (const screenshot of manifest.screenshots || []) {
    assert.equal(fs.existsSync(path.join(projectRoot, 'public', screenshot.src)), true);
  }
});

test('service worker caches only maintained same-origin application assets', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'public', 'sw.js'), 'utf8');
  const staticAssets = source.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/);
  assert.ok(staticAssets);
  const assetPaths = [...staticAssets[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const asset of assetPaths) {
    const relativePath = asset === '/' ? 'index.html' : asset.replace(/^\//, '');
    assert.equal(fs.existsSync(path.join(projectRoot, 'public', relativePath)), true, `${asset} must exist`);
  }
  assert.doesNotMatch(source, /navigation-data/);
  assert.doesNotMatch(source, /avatar\.svg/);
  assert.doesNotMatch(staticAssets[1], /https:\/\//);
  assert.match(source, /request\.url\.includes\('\/api\/navigation'\)/);
  assert.match(source, /payload\.isMockData !== true/);
  assert.match(source, /cache-control.*no-store/);
});

test('navigation records are rendered without interpolating external text into HTML', () => {
  const renderer = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'ui-renderer.js'),
    'utf8'
  );
  const linkManager = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'features', 'link-manager.js'),
    'utf8'
  );

  assert.doesNotMatch(renderer, /innerHTML\s*=\s*`[\s\S]*\$\{tool\./);
  assert.doesNotMatch(renderer, /li\.innerHTML/);
  assert.match(renderer, /document\.createTextNode\(` \$\{category\}`\)/);
  assert.match(renderer, /nameElement\.textContent = name/);
  assert.match(linkManager, /text\.textContent = message/);
});

test('favicon rendering has a stable, visible fallback and local UI icon assets', () => {
  const server = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const renderer = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'ui-renderer.js'),
    'utf8'
  );
  const index = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');

  assert.match(server, /icons\.duckduckgo\.com/);
  assert.match(server, /&sz=\$\{size\}/);
  assert.match(server, /const faviconCache = new Map\(\)/);
  assert.match(server, /status\(404\)\.json/);
  assert.doesNotMatch(server, /transparent.*1x1/i);
  assert.doesNotMatch(renderer, /Math\.random\(\)/);
  assert.match(renderer, /naturalWidth <= 1/);
  assert.match(renderer, /faviconProxyUrl\.searchParams\.set\('size', '64'\)/);
  assert.match(index, /\/vendor\/bootstrap-icons\/bootstrap-icons\.min\.css/);
  assert.doesNotMatch(index, /cdn\.jsdelivr\.net\/npm\/bootstrap-icons/);
});

test('homepage exposes search, grouped navigation and explicit management mode', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'ui-renderer.js'),
    'utf8'
  );
  const app = fs.readFileSync(path.join(projectRoot, 'public', 'js', 'app.js'), 'utf8');

  assert.match(index, /id="site-search-input"/);
  assert.match(index, /id="manage-links-btn"/);
  assert.match(index, /id="favicon-preview"/);
  assert.match(index, /id="site-count"/);
  assert.match(index, /id="favicon-preview-domain"/);
  assert.match(renderer, /className = 'category-section'/);
  assert.match(renderer, /--tool-hue/);
  assert.match(renderer, /setSearchQuery\(value\)/);
  assert.match(app, /classList\.toggle\('edit-mode'\)/);
});

test('homepage uses the modern local visual system without external fonts', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'public', 'css', 'style.css'), 'utf8');
  const renderer = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'ui-renderer.js'),
    'utf8'
  );
  const themeManager = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'theme-manager.js'),
    'utf8'
  );

  assert.doesNotMatch(index, /fonts\.googleapis\.com|Orbitron/);
  assert.doesNotMatch(css, /font-family:\s*["']Orbitron/);
  assert.match(index, /class="search-capsule"/);
  assert.match(index, /class="search-actions search-secondary-actions"/);
  assert.match(css, /v1\.7：现代深空视觉系统/);
  assert.match(css, /width: min\(100%, 980px\)/);
  assert.match(css, /\.search-capsule > select \{[\s\S]*?width: 118px/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.search-capsule > select \{[\s\S]*?width: 112px/);
  assert.match(css, /\.tool-domain/);
  assert.match(renderer, /getDisplayHostname/);
  assert.match(renderer, /tool-open-indicator/);
  assert.match(themeManager, /name: '深空灰'/);
  assert.match(themeManager, /primaryBg: '#0B0F17'/);
});

test('command palette supports local pinyin matching and keyboard navigation', () => {
  const index = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const palette = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'features', 'command-palette.js'),
    'utf8'
  );
  const renderer = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'ui-renderer.js'),
    'utf8'
  );
  const PinyinMatch = require('pinyin-match');

  assert.match(index, /id="command-palette"/);
  assert.match(index, /vendor\/pinyin-match\/pinyin-match\.js/);
  assert.doesNotMatch(index, /unpkg\.com|cdn\.jsdelivr\.net\/npm\/pinyin-match/);
  assert.match(palette, /event\.key === 'ArrowDown'/);
  assert.match(palette, /event\.key === 'ArrowUp'/);
  assert.match(palette, /event\.key === '\/'/);
  assert.match(palette, /window\.open\(safeUrl, '_blank'/);
  assert.match(renderer, /window\.PinyinMatch\.match/);
  assert.notEqual(PinyinMatch.match('百度', 'bd'), false);
  assert.notEqual(PinyinMatch.match('哔哩哔哩', 'bili'), false);
});

test('personalization remains local and navigation supports compact view and scroll spy', () => {
  const personalization = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'features', 'personalization-manager.js'),
    'utf8'
  );
  const renderer = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'ui-renderer.js'),
    'utf8'
  );
  const css = fs.readFileSync(path.join(projectRoot, 'public', 'css', 'style.css'), 'utf8');

  assert.match(personalization, /navsite_pinned_sites/);
  assert.match(personalization, /navsite_recent_sites/);
  assert.match(personalization, /navsite_view_mode/);
  assert.doesNotMatch(personalization, /fetch\(/);
  assert.match(renderer, /new IntersectionObserver/);
  assert.match(renderer, /scrollIntoView\(\{ behavior: 'smooth'/);
  assert.match(renderer, /category-menu-badge/);
  assert.match(css, /body\[data-view-mode="compact"\]/);
  assert.match(css, /\.particles\s*\{\s*display: none;/);
});

test('cached navigation data is rendered first and refreshed in the background', () => {
  const dataManager = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'data-manager.js'),
    'utf8'
  );

  assert.match(dataManager, /setTimeout\(\(\) => this\.refreshNavigationData\(\), 0\)/);
  assert.match(dataManager, /new CustomEvent\('navigationRefreshed'/);
  assert.match(dataManager, /if \(result\.isMockData \|\| result\.degraded\) return/);
  assert.match(dataManager, /后台刷新导航数据失败，继续使用本地缓存/);
});

test('PWA manager leaves installation UI to the browser', () => {
  const pwaManager = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'pwa-manager.js'),
    'utf8'
  );

  assert.doesNotMatch(pwaManager, /beforeinstallprompt/);
  assert.doesNotMatch(pwaManager, /bindInstallEvents/);
});
