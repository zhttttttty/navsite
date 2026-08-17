const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.dirname(require.resolve('bootstrap-icons/package.json'));
const sourceRoot = path.join(packageRoot, 'font');
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
