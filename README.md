# Hollowmere

A browser multiplayer shooter built with Next.js, Three.js, Rapier and Colyseus. The village supports first- and third-person play, team deathmatch and free-for-all, bot-filled matches, room codes, five weapons, grenades, respawns and scoreboards.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the web URL printed by Next.js (normally http://localhost:3000). The game server listens on port 2567. `npm run dev:web` and `npm run dev:server` run them separately. Models, collision meshes and environment textures are included in `public/`; raw source packs are excluded.

## Controls

WASD move, mouse look, left-click fire, right-click aim, Shift sprint, Space jump, C/Ctrl crouch, R reload, 1/2 or Q switch weapons, hold G to cook a grenade and release to throw, V toggle camera, Tab scoreboard, Esc release the mouse. Touch devices have movement, look and action controls. Loadout changes apply on the next spawn.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
# With both servers running and Chrome installed:
npx tsx scripts/dev/play-test.ts http://localhost:3000
npx tsx scripts/dev/network-test.ts ws://localhost:2567
```

Unit tests cover snapshot interpolation, angle wrapping, stale packets, extrapolation limits and respawn discontinuities. The browser smoke test checks two-player room joining, gun handling, camera switching, grenades, scoreboard, leaving and bot-filled quick play. The network test checks authoritative damage, kills and respawns in a private room.

## Production at /fps

Build with `NEXT_PUBLIC_BASE_PATH=/fps npm run build`. This prefixes both Next routes and Three.js assets. The client connects through the same origin at `/fps/server`, using WSS on HTTPS. For a separate game host, set `NEXT_PUBLIC_GAME_SERVER_URL` at build time.

The supplied `deploy/ecosystem.config.cjs` runs the web app on loopback port 3006 and the game server on loopback port 2567. It assumes `/var/www/fps-shooter` and PM2. Include `deploy/nginx-locations.conf` in the domain's existing HTTPS server block, validate with `nginx -t`, and reload Nginx. Start with `pm2 start deploy/ecosystem.config.cjs` and `pm2 save`.

The room state lives in memory. Restarting the game server ends current matches. Client movement is predicted locally and checked for speed on the server; damage, ammunition and scoring are server-owned. This is a playable prototype, not a hardened competitive anti-cheat system.

## Assets

The asset import scripts document the original packs and transformations: Quaternius characters, animation, environment kits and weapons, plus Poly Haven environment textures and HDR skies. `scripts/import-assets.ts` rebuilds optimized assets from the ignored `assets-raw` directory. See the source scripts for pack names and download sources.
