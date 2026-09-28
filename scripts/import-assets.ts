// Converts the raw CC0 packs in assets-raw/ into web-ready files in public/models
// plus metadata in game/shared/generated. Usage: npm run assets [-- village weapons ...]
import { ready } from "./assets/common";
import { KITS, importKit } from "./assets/kits";
import { importWeapons } from "./assets/weapons";
import { importCharacters } from "./assets/characters";

const STAGES: Record<string, () => Promise<void>> = {
  village: () => importKit(KITS.village),
  nature: () => importKit(KITS.nature),
  props: () => importKit(KITS.props),
  weapons: importWeapons,
  characters: importCharacters,
};

async function main() {
  await ready();
  const wanted = process.argv.slice(2);
  for (const [name, run] of Object.entries(STAGES)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const t = Date.now();
    await run();
    console.log(`  done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
