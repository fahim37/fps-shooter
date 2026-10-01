# Hollowmere

A browser multiplayer shooter built with Next.js, Three.js, Rapier and Colyseus. The village supports first- and third-person play, team deathmatch and free-for-all, bot-filled matches, room codes, five weapons, grenades, respawns and scoreboards.

Play at https://fahimstack.tech/fps. Create a room, then use **Copy invite link** in the match menu. Friends can open that link and press **Join this room**, or paste the link/code into the lobby. Quick play matches the selected game mode. Press Esc during a match to find the invite controls again.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the web URL printed by Next.js (normally http://localhost:3000). The game server listens on port 2567. `npm run dev:web` and `npm run dev:server` run them separately. Models, collision meshes and environment textures are included in `public/`; raw source packs are excluded.

## Controls

WASD move, mouse look, left-click fire, right-click aim, Shift sprint, Space jump, C/Ctrl crouch, R reload, 1/2 or Q switch weapons, hold G to cook a grenade and release to throw, V toggle camera, Tab scoreboard, Esc release the mouse. Loadout changes apply on the next spawn.

The crosshair turns red over a visible, vulnerable enemy. ADS smoothly zooms and reduces mouse sensitivity; sniper aim uses a circular optic. Blood spray and nearby surface splatter follow server-confirmed bullet hits, while a faint hitmarker gives instant local feedback. Automatic-fire timing keeps its cadence across common rendering rates without firing catch-up bursts after a stall.

On mobile, use the left thumbstick and drag the right side to look. Both fire buttons can be held independently; the right fire and ADS buttons also support dragging to aim. Jump is held, crouch and sprint toggle, and grenade is held to cook then released to throw. Camera, scores and pause have separate buttons. Tap **Layout**, or **Customize touch controls** in the pause menu, to drag controls, resize them and adjust transparency. **Save & play** remembers the layout in this browser on this device, with separate positions for landscape and portrait. Reset restores the default arrangement.

Graphics can change during a match: press **F6**, use the pause-menu selector, or tap the mobile graphics button. Low removes shadows and postprocessing, simplifies terrain and reduces nearby foliage and combat effects. **Auto-adjust resolution** lowers render resolution under sustained frame drops, then recovers it when performance improves. Preferences persist locally; changing quality keeps the room and weapon state.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
# With both servers running and Chrome installed:
npx tsx scripts/dev/play-test.ts http://localhost:3000
npx tsx scripts/dev/network-test.ts ws://localhost:2567
npx tsx scripts/dev/rig-test.ts http://localhost:3000
npx tsx scripts/dev/combat-test.ts http://localhost:3000
npx tsx scripts/dev/graphics-test.ts http://localhost:3000
npx tsx scripts/dev/mobile-test.ts http://localhost:3000
```

Unit tests cover networking interpolation, invites, hit detection, ADS sensitivity, targeting through cover, automatic cadence, character pose drift, IK, bounded combat effects, touch input and graphics adaptation. Browser checks exercise combat confirmation, scope release, live graphics changes, simultaneous mobile gestures and layout persistence. The network test checks authoritative headshots, ammunition acknowledgments, fire-rate limits, kills and respawns in a private room. The rig test exercises 90 body/weapon/pose combinations, checks skinned vertices, and verifies that held poses cannot accumulate torso or arm rotations.

## Production at /fps

Build with `NEXT_PUBLIC_BASE_PATH=/fps npm run build`. This prefixes both Next routes and Three.js assets. The client connects through the same origin at `/fps/server`, using WSS on HTTPS. For a separate game host, set `NEXT_PUBLIC_GAME_SERVER_URL` at build time.

The supplied `deploy/ecosystem.config.cjs` runs the web app on loopback port 3006 and the game server on loopback port 2567. It assumes `/var/www/fps-shooter` and PM2. Include `deploy/nginx-locations.conf` in the domain's existing HTTPS server block, validate with `nginx -t`, and reload Nginx. Start with `pm2 start deploy/ecosystem.config.cjs` and `pm2 save`.

The room state lives in memory. Restarting the game server ends current matches. Client movement is predicted locally and checked for speed on the server; damage, ammunition and scoring are server-owned. This is a playable prototype, not a hardened competitive anti-cheat system.

## Assets

The asset import scripts document the original packs and transformations: Quaternius characters, animation, environment kits and weapons, plus Poly Haven environment textures and HDR skies. `scripts/import-assets.ts` rebuilds optimized assets from the ignored `assets-raw` directory. See the source scripts for pack names and download sources.
