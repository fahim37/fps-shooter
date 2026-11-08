# Characters and lobby showoffs

Everyone plays the same character: "Soldier Full Tactical Gear (LowPolyGameReady)" by DanlyVostok (Sketchfab, posted as free to use). Its Character Creator rig is replaced by the Universal Animation Library skeleton the game already animates (the old Rangers' skeleton, kept in `game/shared/generated/skeleton.json`), so locomotion, aiming, weapon IK, grips and hitboxes are unchanged. Teams are told apart by a tint on the jacket, trousers and helmet cover. First person shows the soldier's own sleeves and gloves.

The home screen previews the soldier. Waiting rooms replicate each player's showoff to everyone, including late joiners. At ease, Dance, Talk and Spell stance loop until changed or the match starts. Showoffs never affect readiness, movement, damage or hitboxes. The server accepts only these four IDs in the waiting phase, at most once every 750 ms.

## Runtime budget

| Asset | Previous | Optimized |
| --- | ---: | ---: |
| Soldier, in matches (28,000 triangles, 2 materials) | 84,158 triangles, 12 materials, 31 4K maps | 1,484,728 bytes |
| Soldier, lobby (full detail, 4K body atlas) | — | 3,049,352 bytes |
| Lobby animation set | — | 87,284 bytes |

The lobby loads only the full-detail soldier; matches load only the lighter one. These are file-size measurements, not an FPS benchmark.

- One lobby renderer shows every human in the room together (up to 20), capped at 30 FPS and 1.25 device pixel ratio, rendering only when something moves. Up to six stand in one row; larger rooms zig-zag across a front row and a raised back row, Blue on the left and Red on the right. The camera fits the whole formation and its name tags at any aspect ratio, and tags shorten (name only, then alternating lines) as slots narrow. Joins and leaves add or remove single actors instead of rebuilding the scene.
- No world, physics, weapons, HDR environment, postprocessing or shadow maps loaded by the preview.
- Only `soldier_hq.glb` and `lobby-anims.glb` are requested; skeletons and mixers are independent per actor.
- Offscreen and hidden-tab rendering pauses. Reduced-motion preferences freeze animations; Pause motion and Hide preview are also available.
- Preview load/WebGL failures leave room controls usable, with a retry button.
- 1024px WebP textures, welded geometry, Meshopt compression, and conservative accessory simplification (55% target, 0.1% mesh-radius error limit, borders locked). Faces, hands and first-person arms are not simplified.
- Gameplay ships 26 selected clips; the lobby separately ships four clips (about 87 KB). Unused animation tracks and keyframes are removed.

## Rebuild

Put `Mark_1_Olive_IdlePose.fbx` (from the download's `source/Mark_1.zip`) and the `textures/` folder at `assets-raw/soldier`, then run `npx tsx scripts/import-assets.ts soldier`. It writes `public/models/soldier.glb` (simplified part by part: the 26,500-triangle helmet keeps a tenth) and `public/models/soldier_hq.glb` (no simplifying). Each packs the 12 materials into a body atlas and an arms atlas (albedo with the team-tint mask in alpha, normal, occlusion/roughness/metal).

The `characters` stage now builds only the animation sets, from the Universal Animation Library packs (CC0; license text in `docs/licenses`). The importer fails if a required animation is missing.

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
