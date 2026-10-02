# Characters and lobby showoffs

The two playable Rangers use Quaternius Universal Base Characters (male/female faces, eyes and brows; optional male beard) with the existing Modular Character Outfits Ranger clothing. Both use the same animation skeleton as Universal Animation Library. Gameplay keeps its existing layered locomotion, aiming and weapon IK.

The home screen previews the selected body. Waiting rooms replicate each player's showoff to everyone, including late joiners. At ease, Dance, Talk and Spell stance loop until changed or the match starts. Showoffs never affect readiness, movement, damage or hitboxes. The server accepts only these four IDs in the waiting phase, at most once every 750 ms.

## Runtime budget

| Asset | Previous | Optimized |
| --- | ---: | ---: |
| Male Ranger | 2,562,260 bytes | 1,245,156 bytes |
| Female Ranger | 2,593,044 bytes | 1,273,644 bytes |
| Lobby animation set | — | 87,284 bytes |

The combined character download is 51% smaller. These are file-size measurements, not an FPS benchmark.

- One lobby renderer, at most two visible characters per page, capped at 30 FPS and 1.25 device pixel ratio.
- No world, physics, weapons, HDR environment, postprocessing or shadow maps loaded by the preview.
- Only the visible character body and `lobby-anims.glb` are requested. Geometry/textures are cached and shared with gameplay; skeletons and mixers are independent.
- Offscreen and hidden-tab rendering pauses. Reduced-motion preferences freeze animations; Pause motion and Hide preview are also available.
- Preview load/WebGL failures leave room controls usable, with a retry button.
- 1024px WebP textures, welded geometry, Meshopt compression, and conservative accessory simplification (55% target, 0.1% mesh-radius error limit, borders locked). Faces, hands and first-person arms are not simplified.
- Gameplay ships 26 selected clips; the lobby separately ships four clips (about 87 KB). Unused animation tracks and keyframes are removed.

## Rebuild

Existing ignored `assets-raw` packs remain the default. Override the two supplied packs in PowerShell:

```powershell
$env:CHARACTER_PACK = 'C:\Users\bdcalling\Downloads\Universal Base Characters[Standard]\Universal Base Characters[Standard]'
$env:ANIMATION_PACK = 'C:\Users\bdcalling\Downloads\Universal Animation Library[Standard]\Universal Animation Library[Standard]'
npx tsx scripts/import-assets.ts characters
```

The existing Ranger outfit and Universal Animation Library 2 packs in `assets-raw` are also needed to rebuild the established outfits and extra combat clips. The importer fails if a required animation is missing. Both supplied packs identify their license as CC0; retained license text is in `docs/licenses`.

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run build
npx tsx scripts/dev/rig-test.ts http://localhost:3000
npx tsx scripts/dev/lobby-network-test.ts ws://localhost:2567
npx tsx scripts/dev/lobby-test.ts http://localhost:3000
npx tsx scripts/dev/showcase-test.ts http://localhost:3000
```

The rig test checks both bodies with every weapon through 90 movement, crouch, aim, reload, recoil, death and respawn poses. Lobby checks cover selection, two-way showoff replication, rate limiting, invalid messages, match transitions, asset isolation and mobile layout. Screenshots are written to ignored `out/qa`.
