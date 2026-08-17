const fs = require('node:fs');
const path = require('node:path');

const bootstrapPackageRoot = path.dirname(require.resolve('bootstrap-icons/package.json'));
const sourceRoot = path.join(bootstrapPackageRoot, 'font');
const targetRoot = path.join(__dirname, '..', 'public', 'vendor', 'bootstrap-icons');
const targetFonts = path.join(targetRoot, 'fonts');

fs.mkdirSync(targetFonts, { recursive: true });
fs.copyFileSync(
  path.join(sourceRoot, 'bootstrap-icons.min.css'),
  path.join(targetRoot, 'bootstrap-icons.min.css')
);

for (const filename of ['bootstrap-icons.woff', 'bootstrap-icons.woff2']) {
  fs.copyFileSync(path.join(sourceRoot, 'fonts', filename), path.join(targetFonts, filename));
}

console.log('Copied Bootstrap Icons assets into public/vendor.');

const pinyinPackageRoot = path.dirname(require.resolve('pinyin-match/package.json'));
const pinyinTargetRoot = path.join(__dirname, '..', 'public', 'vendor', 'pinyin-match');
const pinyinSource = fs.readFileSync(path.join(pinyinPackageRoot, 'lib', 'main.js'), 'utf8');
const pinyinBrowserBundle = `(function () {\n  const module = { exports: {} };\n${pinyinSource}\n  window.PinyinMatch = module.exports;\n})();\n`;

fs.mkdirSync(pinyinTargetRoot, { recursive: true });
fs.writeFileSync(path.join(pinyinTargetRoot, 'pinyin-match.js'), pinyinBrowserBundle, 'utf8');
fs.copyFileSync(path.join(pinyinPackageRoot, 'LICENSE'), path.join(pinyinTargetRoot, 'LICENSE'));

console.log('Copied pinyin-match browser assets into public/vendor.');
