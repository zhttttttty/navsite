const path = require('node:path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'public', 'img', 'logo.png');
const outputDirectory = path.join(projectRoot, 'public', 'img', 'icons');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function generateIcons() {
  await Promise.all(sizes.map(size => (
    sharp(source)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ compressionLevel: 9 })
      .toFile(path.join(outputDirectory, `icon-${size}x${size}.png`))
  )));
  console.log(`Generated ${sizes.length} PWA icons from public/img/logo.png`);
}

generateIcons().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
