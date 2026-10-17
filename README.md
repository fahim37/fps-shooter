# Hollowmere

A browser multiplayer shooter built with Next.js, Three.js, Rapier and Colyseus. Two maps, Village and Downtown, support first- and third-person play, team deathmatch and free-for-all, bot-filled matches, room codes, five weapons, grenades, respawns and scoreboards.

Play at https://fahimstack.tech/fps. Create a room, then use **Copy invite link** in the match menu. Friends can open that link and press **Join this room**, or paste the link/code into the lobby. Quick play matches the selected game mode. Press Esc during a match to find the invite controls again.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the web URL printed by Next.js (normally http://localhost:3000). The game server listens on port 2567. `npm run dev:web` and `npm run dev:server` run them separately. Models, collision meshes and environment textures are included in `public/`; raw source packs are excluded.

## Maps

- **Village**: timber houses around a market plaza, open lanes and forest edges.
- **Downtown**: a city crossing with prefab buildings along a 4-lane avenue and cross street, alleys into walled courtyards, and an enterable corner shop with rooftop stairs in each courtyard. The layout is 180° symmetric, so Blue (west) and Red (east) get mirror-image halves.

Pick the map on the lobby's map cards when creating a room or using Quick play (Quick play matches rooms on that map); the choice is remembered in the browser. The room host can switch maps in the waiting room until the match starts, and everyone sees the change. Room listings show each room's map.

Downtown loads only its own 2.7 MB kit (no village, foliage or grass textures). Prefab facades are simplified on import, collide as boxes, and draw once per material for the whole map. On an Intel UHD Graphics 730 at Low (frame cap removed) it measured about 93 FPS versus 59 for the village, and 60 FPS with vsync had a 99th-percentile frame time of 17 ms and no frames over 50 ms while sprinting and turning. World shaders and textures are compiled and uploaded while the deploy menu is open, so turning a corner never stalls on first use (this also removed the village's occasional 67 ms hitches).

## Controls

WASD move, mouse look, left-click fire, right-click aim, Shift sprint, Space jump, C/Ctrl crouch, R reload, 1/2 or Q switch weapons, hold G to cook a grenade and release to throw, V toggle camera, Tab scoreboard, Esc release the mouse. Loadout changes apply on the next spawn.

Ctrl keyboard shortcuts and Ctrl+wheel browser zoom are blocked while game controls are active, so crouching while moving or reloading does not trigger browser actions. Both Ctrl keys crouch. Choose **Enter fullscreen match** for additional browser shortcut capture where supported; the browser may request permission. Esc still exits gameplay, and shortcuts work normally in menus. Browser/OS shortcuts that are not exposed to web pages cannot be disabled by the game.

The crosshair turns red over a visible, vulnerable enemy. ADS smoothly zooms and reduces mouse sensitivity; red-dot aim uses a compact angular reflex sight with a clear lens and crisp center dot, while sniper aim uses a circular optic. In third person, aiming with a red dot or a scope switches to the view through that sight. The reflex sight scales for desktop and mobile and fades out when aiming is released. Blood spray and nearby surface splatter follow server-confirmed bullet hits, while a faint hitmarker gives instant local feedback. Automatic-fire timing keeps its cadence across common rendering rates without firing catch-up bursts after a stall.

A north-up minimap at the top right shows the village roads, plaza and actual building footprints. Your arrow shows your facing direction; blue dots mark teammates and red dots mark all living enemies. Above/below chevrons identify players on another floor. Positions follow the rendered players and disappear on death or disconnect. The map scales down on mobile, and the kill feed moves below it (alongside it on short landscape screens).

The kill feed shows weapon silhouettes and names, headshots, team colors, and highlighted eliminations involving YOU. Every confirmed kill also displays a prominent YOU ELIMINATED banner naming your victim for 2.8 seconds, with headshot, rapid multi-kill and streak details. It remains visible for trade kills, and never appears for predicted hits or other players? kills. After a death, the camera briefly holds your position before cutting to a collision-checked close-up of your killer. The death report shows the lethal weapon, hit type, distance, killer health at the moment of elimination, and automatic respawn countdown. This is a live killer view; it holds the last known position if the attacker dies, disconnects or respawns. Environmental deaths show their actual cause. Bullet streaks leave a brief fading trail: gold for your shots, blue for teammates and orange for enemies. Effects stay bounded at every graphics preset.

On mobile, use the left thumbstick and drag the right side to look. Both fire buttons can be held independently; the right fire and ADS buttons also support dragging to aim. Jump is held, crouch and sprint toggle, and grenade is held to cook then released to throw. Camera, scores and pause have separate buttons. Tap **Layout**, or **Customize touch controls** in the pause menu, to drag controls, resize them and adjust transparency. **Save & play** remembers the layout in this browser on this device, with separate positions for landscape and portrait. Reset restores the default arrangement.

Mobile play requests fullscreen on the first touch after loading and tries to lock landscape orientation. Use **Fullscreen** to retry or **Exit fullscreen** to leave it. Unsupported browsers keep the game fitted to the viewport. Browser and operating-system gestures remain controlled by the device.

Graphics can change during a match: press **F6**, use the pause-menu selector, or tap the mobile graphics button. Low removes shadows and postprocessing, simplifies terrain and reduces nearby foliage and combat effects. **Auto-adjust resolution** lowers render resolution under sustained frame drops, then recovers it when performance improves. Preferences persist locally; changing quality keeps the room and weapon state.

Low also removes non-colliding grass and flowers, preserves a clearer minimum render resolution, and keeps the same draw distance as Medium. Enemy outfits receive a subtle warm edge accent and a texture-colored minimum light in shade using their existing material draw, with normal depth testing and fog. Skin, eyes and hair keep their natural materials; no gray lighting floor is applied. Teammates keep their normal team colors. Switching to another quality restores the original materials immediately.

**Clearer combat view**, enabled by default in Game Settings & Controls, reduces bloom and ambient-occlusion darkness and removes decorative screen-edge shading. Turn it off to restore the cinematic effects. Scope masks and damage feedback remain visible.

Camera and character rendering interpolate between the 120 Hz physics steps to smooth movement on displays whose refresh rate differs from the simulation. Translation trails the simulation by one step (8.3 ms); mouse rotation stays immediate, and collision, shot origins and network poses use the current physical position. Respawns and server corrections reset interpolation immediately. Finished locomotion blends stop sampling unused animation tracks, static scenery avoids rebuilding unchanged transforms, and weapon/loadout panels subscribe only to the HUD values they display. Resolution adaptation pauses in loadout menus and while disconnected.

Arm IK reuses the rig's current world matrices instead of repeatedly updating ancestor bones. A local Chrome benchmark with ten shipped character/weapon rigs measured a median update cost of 0.446 ms before and 0.311 ms after this change (about 30% less animation CPU time; this is not a whole-game FPS measurement). Audio updates also skip unchanged volume and listener parameters. Reproduce the animation benchmark with `npx tsx scripts/dev/rig-benchmark.ts http://localhost:3000`; results are saved under `out/qa/`.

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
npx tsx scripts/dev/deathcam-test.ts http://localhost:3000
npx tsx scripts/dev/minimap-test.ts http://localhost:3000
npx tsx scripts/dev/map-test.ts http://localhost:3000
npx tsx scripts/dev/graphics-test.ts http://localhost:3000
npx tsx scripts/dev/mobile-test.ts http://localhost:3000
```

Unit tests cover networking interpolation, invites, hit detection, ADS sensitivity, targeting through cover, automatic cadence, character pose drift, IK, bounded combat effects, touch input and graphics adaptation. Browser checks exercise combat confirmation, scope release, live graphics changes, simultaneous mobile gestures and layout persistence. The network test checks authoritative headshots, ammunition acknowledgments, fire-rate limits, kills and respawns in a private room. The rig test exercises 90 body/weapon/pose combinations, checks skinned vertices, and verifies that held poses cannot accumulate torso or arm rotations.

## Production at /fps

Build with `NEXT_PUBLIC_BASE_PATH=/fps npm run build`. This prefixes both Next routes and Three.js assets. The client connects through the same origin at `/fps/server`, using WSS on HTTPS. For a separate game host, set `NEXT_PUBLIC_GAME_SERVER_URL` at build time.

The supplied `deploy/ecosystem.config.cjs` runs the web app on loopback port 3006 and the game server on loopback port 2567. It assumes `/var/www/fps-shooter` and PM2. Include `deploy/nginx-locations.conf` in the domain's existing HTTPS server block, validate with `nginx -t`, and reload Nginx. Start with `pm2 start deploy/ecosystem.config.cjs` and `pm2 save`.

The Nginx snippet serves models, environment textures and build assets directly from disk. Hashed JavaScript/CSS assets use a one-year immutable cache and gzip compression; models and textures revalidate their ETags because their filenames do not change with each release. WebSocket traffic remains unbuffered. Build the replacement in a separate directory before switching `.next` and restarting only the two Hollowmere processes.

The room state lives in memory. Restarting the game server ends current matches. Client movement is predicted locally and checked for speed on the server; damage, ammunition and scoring are server-owned. This is a playable prototype, not a hardened competitive anti-cheat system.

## Assets

The asset import scripts document the original packs and transformations: Quaternius characters, animation, environment kits and weapons, plus Poly Haven environment textures and HDR skies. `scripts/import-assets.ts` rebuilds optimized assets from the ignored `assets-raw` directory. See the source scripts for pack names and download sources.

Downtown uses the Downtown City MegaKit (Standard, CC0) by Quaternius. Put the unzipped pack at `assets-raw/city` and run `npx tsx scripts/import-assets.ts city`. The importer keeps only the pieces the map places, strips the pack's vertex-color shader masks, opens modular windows and doors (removing glass and fake-interior cards that would hide players), halves normal and ORM maps to 512 px, simplifies the prefab buildings by about 40%, and writes box collision for their bodies. `server/maps.test.ts` checks every map's spawns, floors and bot paths against the real collision data and navmeshes.

Male and female Rangers have animated selection previews and shared lobby showoffs (At ease, Dance, Talk and Spell stance). See [character assets and lobby showoffs](docs/characters.md) for optimization budgets, pack overrides, and validation commands.

When creating a room with friends, **Score to win** sets the elimination target: 30, 60 (default), 100 or 150 for Team Deathmatch, and 20, 30 (default), 50 or 75 for Free for All. Higher targets get a longer clock (100 → 20 minutes, 150 → 25 minutes) so they stay reachable; the waiting room shows the target and match length.

Room readiness stays set until the player cancels it, including roster changes, team changes, reconnects and subsequent rounds. The host still starts each round. Warmup and active matches remain open while seats are available; joining players can choose Blue, Red or Auto assign in the invite form or public room browser. Team capacity is enforced by the server and late joiners receive a protected spawn. Departures do not cancel the countdown.

Custom rooms support up to 20 players (10v10). Teams can start uneven, including 4v5 or 3v6, once everyone is ready and each team has a player (or practice bots are enabled). Choose a room size large enough for the larger team. In the waiting room, use **Join team** or click an **Open slot** on the other team to switch without losing readiness. Duel and Doubles keep their 1v1 and 2v2 formats.

In a match, voice is an icon bar under the scores: **Team**, **All**, a **mic** button and a settings button. Push-to-talk: hold **N** (or the Team icon) to talk to your team, or **M** (or the All icon) to talk to all players (both go to All in Free for All). The first press asks for microphone access; if it is still held once the microphone opens, you start talking. The mic button switches to an open mic that transmits all the time on the selected channel (the last Team / All icon you used); click it again to go back to push-to-talk. Push-to-talk keys still work while the mic is open. **Team** transmits only to teammates; **All players** transmits to everyone who joined voice. You can hear both your teammates' Team voice and All voice regardless of your transmit channel. Free-for-all uses All. The settings button has sound mute, volume and individual player mute controls. Leaving voice or the match stops microphone capture; disconnects require rejoining voice.

Voice uses WebRTC audio between players, with room-scoped signaling through the game server. HTTPS (or localhost) is required for microphone access. The default ICE configuration uses Google's public STUN service. For networks that block direct connections, set the game server's `VOICE_TURN_URLS` (comma-separated TURN URLs) and `VOICE_TURN_SECRET` to match coturn's `static-auth-secret`. The server issues one-hour TURN credentials only to players who join voice and refreshes the configuration on subsequent voice activity; the shared secret stays on the server. The PM2 config optionally reads these settings from `/etc/hollowmere/voice.json` (or `HOLLOWMERE_VOICE_CONFIG`), which should be readable only by the deployment user. A build-time `NEXT_PUBLIC_VOICE_ICE_SERVERS` JSON array is also supported for custom ICE configurations; its contents are browser-visible. This mesh implementation can make 19 peer connections per player in a full 10v10 room; production voice at that size should be load-tested on the intended devices and networks.

On a dedicated Ubuntu relay host, install `coturn`, then run `sudo python3 deploy/setup-voice.py PUBLIC_IP` and `sudo systemctl enable --now coturn`. For a host behind NAT, pass its local IPv4 address as a second argument. This creates the private shared-secret configuration, binds relay sockets to the intended interface, limits allocations and bandwidth, and blocks relay connections to private address ranges. Permit TCP/UDP 3478 and UDP 49160–50159 through the host/provider firewall. Restart the game using `pm2 startOrReload deploy/ecosystem.config.cjs --only hollowmere-game --update-env`. Run `npx tsx scripts/dev/multiplayer-voice-test.ts URL` for browser verification with three synthetic microphones; set `VOICE_TEST_FORCE_RELAY=1` to require TURN rather than a direct connection, and `GAME_SERVER_PORT` to use a game server on another local port.

A bottom-center health bar shows HP, amber/red damage states, a five-second cover countdown and a regeneration indicator driven by confirmed server health increases. After five seconds without another hit, health regenerates at 20 HP per second up to 100; taking damage restarts the delay. The bar sits above the weapon controls on desktop and touch layouts.
