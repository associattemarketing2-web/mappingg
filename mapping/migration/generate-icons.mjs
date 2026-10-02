// Regenerates the PWA/app icons from the Mappingg logo mark so the installed
// app shows the Mappingg brand (not the Associatte logo).
//   node migration/generate-icons.mjs
import sharp from 'sharp';

const SRC = 'public/img/mappingg-icon-mark.png';
const OUT = 'public/icons';
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function make(size, pad, file) {
  const inner = Math.round(size * (1 - pad));
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(`${OUT}/${file}`);
  console.log('wrote', `${OUT}/${file}`);
}

// "any" icons: generous logo; maskable: smaller logo inside the safe zone.
await make(192, 0.30, 'icon-192.png');
await make(512, 0.30, 'icon-512.png');
await make(192, 0.42, 'icon-192-maskable.png');
await make(512, 0.42, 'icon-512-maskable.png');
await make(180, 0.26, 'apple-touch-icon.png');
console.log('Done.');
