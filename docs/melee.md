# Blades: animation and feel brief (for Astra)

You are working in this repo (`fps-shooter`, a browser FPS built with Next.js, three.js and a Colyseus server). Two melee weapons are set up and playable: the **Butterfly Knife** (a balisong) and the **Katana**. Their models, holds, hit detection, speed boost, sounds and a first set of swing animations are in place. **Your job is to make them a joy to use**: the knife's flips and tricks should look like a skilled balisong flipper's, and every swing should feel snappy, weighty and satisfying. The gameplay numbers and the server's hit rules stay as they are unless the user says otherwise.

Read `AGENTS.md` first: this Next.js version differs from what you know.

> **Update, 2026-11-22.** The blades were redone beat for beat from reference footage the user supplied (studied at its full 60 fps). Knife: one fixed inspect of about five seconds (`FLOURISH`), a longer show-off equip (`KNIFE_DRAW`), a thrust and a sweep as the first two light cuts, and a heavy (`KNIFE_HEAVY`) whose held follow-through and recovery flips run past the heavy's interval as looks. Katana: a 7.1 s inspect and an equip with the scabbard parked at the hip (`sheathPark`), and a four-cut combo of big arcs (`arc`). A blade's draw and heavy may run past their gameplay times (`drawSeconds`, `heavySeconds`); the next attack or inspect cuts them short, and `CharacterRig.blendCuts` eases any such cut from the pose on screen. The old five-trick cycle on T is gone. In the lobby, **Knife inspect** and **Katana inspect** sit among the showoffs: the operator on the lineup takes the blade up and inspects it, seen by the whole room. `scripts/dev/clip-frames.ts` captures any clip frame by frame and `scripts/dev/lobby-showoff-test.ts` checks the lobby.

## What exists now

**Controls**: `3` equips the blade (the loadout's BLADE section chooses which one; the choice is kept in localStorage). The mouse wheel cycles primary → sidearm → blade. Left mouse swings, and holding it keeps swinging at the blade's rate. `Y` plays the inspect. There is no aiming with a blade (right mouse does nothing yet). The player runs faster with a blade out (knife ×1.15, katana ×1.1), and swinging never drops a sprint.

**Stats** (`game/shared/weapons.ts`, `WEAPONS.knife` / `WEAPONS.katana`, plus `melee: { range, arc, backstab }`):
- Knife: 60 damage per hit, 150 swings/min (0.4 s), reach 2.2 m, ±22° sweep, 150 from behind (a one-hit kill).
- Katana: 75 damage per hit, 90 swings/min (0.67 s), reach 2.9 m, ±34° sweep, 150 from behind.
- Health is 100 plus a 20 shield, so two hits kill from the front.

**How a swing works**:
1. `LocalPlayer.tryMelee` (`game/client/core/local.ts`) sends `melee` at once and starts the swing animation (`lastShotAt`, `swings++`).
2. `MatchRoom.melee` (`server/MatchRoom.ts`) resolves the hit immediately: a 7×3 fan of rays against the rewound hitboxes. The nearest body is struck. `isBackstab` decides backstabs.
3. The attacker gets `hit` (with `backstab`). Everyone else gets `swing`, which plays the swing on their copy of the character and the sound.

The hit is decided the moment the swing starts. Animations are looks only and never change what gets hit.

**Models** (`public/models/weapons.glb`, built by `npx tsx scripts/assets/import-assets.ts melee` from `scripts/assets/melee.ts`):
- Weapon space puts the hand's hold at the origin, the blade along −Z (the tip is `WEAPON_META[id].muzzle`), the cutting edge down (−Y) and the flats facing ±X.
- Balisong: the blade is the weapon body. Its two handles are separate moving parts, `safe` and `bite`. Each turns about its own pin, from the data in `weapons-meta.json` (`knife.hinges.{safe,bite}` = pivot, axis, `closed` angle ±π). `0` means open in the hand and `1` means folded shut over the blade. The two handles swing in opposite directions, as a real balisong's do. Extracted in `game/client/assets/weapons.ts` (`PARTS.knife`), driven in `CharacterRig.placeParts`.
- Katana: one rigid piece, guard at z = −0.065, handle back to z = +0.234.

**Animation system** (`game/client/player/handling.ts`): keyframed clips.
- `gun` keys are `[x, y, z, pitch, yaw, roll]` view-space offsets for where the weapon is held: +pitch raises the tip, +yaw swings it left, +roll tips the top left.
- `safe` and `bite` keys animate the balisong handles (0..1).
- `left` and `right` keys move the hands between baked grip poses.
- Segments are smoothstep-eased.
- For blades, the clips are written whole, so every key includes the held pose (`KNIFE_POSE`, `KATANA_POSE`, via `nudge`). They live in `CLIPS.knife` / `CLIPS.katana`:
  - `pose` is the rest hold.
  - `swings: { clips, seconds }` cycles through `clips` by the swing count (forehand, backhand…). Add more clips for combos.
  - `draw` plays over the equip time (the knife flicks open as it comes up).
  - `inspect: { clip, seconds }` is the `Y` move.
- `sampleHandling(..., { swing, sinceInspect })` picks the clip. The arms follow the weapon by IK (`CharacterRig.solveArms`). The same clips drive the third-person body, where `placeGun` applies them more weakly.

**Hands**: grips are solved offline against the real meshes and baked into `game/shared/generated/grips.json`. The specs are in `game/client/dev/gripSolver.ts` (`GRIPS.knife`, `GRIPS.katana`).
- Knife: a right-hand fist round the closed handles. The left hand hangs at the belt (`BELT`).
- Katana: both fists on the handle, right behind the guard and left a hand's width back.
- To rebake, start the web dev server on 3107 (`npx next dev -p 3107`), then run `npx tsx scripts/dev/grip-bake.ts http://localhost:3107 knife,katana`. Do not edit solver or rig files while a bake or screenshot run is going: hot reload kills it.
- If a trick needs the hand in a new place (fingers rolling a handle, a thumb flick, the left hand catching), add a new `RightPose`/`LeftPose` in `grip.ts`, give it a spec in `GRIPS`, and bake.

**Sounds** (`game/client/core/audio.ts`, all procedural Web Audio): `swing` (whoosh), `slash` (hit, heavier on a backstab) and `bladeDraw` (the balisong's latch clicks, the katana leaving its sheath). There are no sounds for the inspect yet.

**Tools for seeing your work**:
- `/dev/rig?fpp=1&weapon=knife&shot=0.13` freezes a swing frame. `shot` is seconds since the swing started; `draw` works the same for the draw. Run `npx tsx scripts/dev/grip-shots.ts <outDir> http://localhost:3107 knife,katana "shot=0.2"` for a first-person view plus close-ups of each hand.
- `/dev/rig?solo=1&weapon=katana&cam=1.3,1.6,2.2&target=0,1.2,0` shows third person.
- `scripts/dev/melee-test.ts` is a real-browser match against the game server (`npx tsx server/index.ts` on 2567). It covers slot 3, inspect, a backstab kill, changing blades and the wheel. Keep it passing.
- Run tests with `npx vitest run` from PowerShell with the `C:\` path (Git Bash's `/c/` path breaks vitest). `server/melee.test.ts` covers the hit rules.
- The rig viewer has no parameter for which swing or how far into an inspect. Add `swing` and `inspect` query parameters (`app/dev/rig/page.tsx` → `RigViewer` → `RigState.swing` / `sinceInspect`) first, so you can scrub through every clip.

## What to build

1. **Balisong tricks: the main event.** Replace the placeholder `KNIFE_INSPECT` with real flipping. Inspect could pick one of several tricks at random each time, or chain them. Aim for the motions real flippers do: a **basic opening/closing flip**, a **chaplin / reverse twirl**, a **helix**, an **aerial** (the knife leaves the hand, spins and is caught), and a **fan** (the knife spinning in the fingers).
   - The handles must swing round their pins smoothly and never pass through the blade or the hand. The `closed` angles already go the right way round.
   - Use the whole-knife `gun` rotation (roll and pitch through a full turn or more) together with the handle swings.
   - For aerials, move the knife off the hand: add a `free` frame or a hand-off-the-weapon key, the way the grenade throw moves the hand off the gun.
   - Let the first-person camera stay steady while the hand works. The fingers ideally move too (thumb flicks, index rolls), via new baked poses.
   - Make the draw a proper flick-open: one handle swings round with a snap and the latch clicks as it locks.
   - Add sounds: handle clicks as each one swings shut or open (`audio.clack` timed to the clip), and a light whoosh on aerials.
2. **Swings that feel great.** Give each attack a short anticipation, a fast cut and a follow-through that settles. Then:
   - Add more variety: knife slashes plus a straight **stab** used when the target is close or every third attack; katana **diagonal cuts, a horizontal sweep and an overhead**.
   - Add a subtle camera nudge in the cut's direction (`LocalPlayer.shotRoll` already does a little), a brief motion trail on the katana's edge (cheap: one strip mesh that fades, and nothing on the Low graphics setting), and a stronger hit feel on contact (hitmarker, `audio.slash`, maybe a 30–50 ms view hitch on a kill).
   - Keep every swing clip no longer than the blade's swing interval, so held attacks chain cleanly.
3. **A heavy attack on right mouse** (ask the user before changing damage numbers):
   - The knife gets a slower, harder stab.
   - The katana gets a charged overhead or a lunge.
   - This needs a second blow type in `MeleeMsg` / `MatchRoom.melee` with its own rate and damage, plus its own clip.
4. **Third person.** Other players should see readable swings. The knife currently stands out on a nearly straight arm in TPP, so bend the elbow and keep it closer to the chest. Give the katana a two-handed ready stance and big readable cuts. Check from the over-the-shoulder camera and from an enemy's view.
5. **Mobile.** Add a touch button to inspect, and make sure the weapon bar's slot 3 works on touch.
6. **Polish the hold.** The katana stands quite tall in first person and covers part of the right-centre of the screen; settle it lower and further right without losing the samurai look. The knife can sit a little higher in view.

## Rules

- **Performance:** most players are on low-end office PCs, so performance comes first. Add no textures, keep extra draw calls to a minimum, and make any effect skippable on Low.
- **Gameplay:** animation must never change hits, and the server stays authoritative. Do not change damage, range, rates or speed without asking.
- **Hands:** keep hands on the weapon with no gaps or fingers sinking in. Rebake grips after any model or hold change, and check the close-ups.
- **Git:** commit only when the user asks, and push straight to `main` when they do. Never add `Co-Authored-By` trailers.
- **Credits:** the balisong model is CC BY 4.0 (Jawa / HELLBRAD) and is credited in the loadout's blade section; keep that credit. The katana is CC0.
- **Before handing back:** typecheck (`npx tsc --noEmit`), run `npx eslint`, run the vitest suite and `scripts/dev/melee-test.ts`, and include screenshots of each new trick and swing (start, middle and end frames).
