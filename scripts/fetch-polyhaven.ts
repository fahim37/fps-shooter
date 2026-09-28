// Downloads CC0 sky + ground textures from Poly Haven into public/env.
// Usage: npx tsx scripts/fetch-polyhaven.ts
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../public/env");
const HDRI = "kloofendal_48d_partly_cloudy_puresky";
const GROUNDS = ["aerial_grass_rock", "forrest_ground_01"];

async function get(url: string, file: string) {
  const dest = path.join(OUT, file);
  if (fs.existsSync(dest)) return console.log("have", file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log("got", file, (fs.statSync(dest).size / 1e6).toFixed(1), "MB");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await (await fetch(`https://api.polyhaven.com/files/${HDRI}`)).json();
  await get(h.hdri["1k"].hdr.url, "sky_1k.hdr");
  await get(h.hdri["2k"].hdr.url, "sky_2k.hdr");
  for (const g of GROUNDS) {
    const t = await (await fetch(`https://api.polyhaven.com/files/${g}`)).json();
    await get(t.Diffuse["1k"].jpg.url, `${g}_diff.jpg`);
    await get(t.nor_gl["1k"].jpg.url, `${g}_nor.jpg`);
    await get(t.arm["1k"].jpg.url, `${g}_arm.jpg`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
