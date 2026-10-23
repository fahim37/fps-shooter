/**
 * Renders the Strikeline emblem (public/brand/strikeline-emblem.svg) into the logo PNG, the
 * favicon, the app icon and the Apple touch icon. Run after changing the emblem:
 *   npx tsx scripts/brand-icons.ts
 */
import fs from "node:fs";
import sharp from "sharp";

const SVG = "public/brand/strikeline-emblem.svg";
const BACKGROUND = "#111812";

const render = (size: number) => sharp(SVG, { density: 384 }).resize(size, size).png().toBuffer();

/** An .ico holding PNG images (supported by every current browser). */
function ico(images: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size % 256, entry); header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

async function main() {
  fs.writeFileSync("public/brand/strikeline-emblem.png", await render(192));
  fs.writeFileSync("app/icon.png", await render(512));
  fs.writeFileSync("app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await render(size) })))));
  // iOS shows no transparency: the emblem on the interface's background, with a margin.
  const inner = await render(140);
  fs.writeFileSync("app/apple-icon.png", await sharp({ create: { width: 180, height: 180, channels: 4, background: BACKGROUND } })
    .composite([{ input: inner, left: 20, top: 20 }]).png().toBuffer());
}

void main();
