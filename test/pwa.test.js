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

test('install prompt waits until a return visit and respects dismissal', () => {
  const pwaManager = fs.readFileSync(
    path.join(projectRoot, 'public', 'js', 'modules', 'core', 'pwa-manager.js'),
    'utf8'
  );

  assert.match(pwaManager, /this\.visitCount >= 2/);
  assert.match(pwaManager, /pwa-install-dismissed/);
  assert.match(pwaManager, /7 \* 24 \* 60 \* 60 \* 1000/);
});
