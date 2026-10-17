"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as THREE from "three";
import { instantiateCharacter, loadLobbyCharacter, type CharacterInstance } from "./assets/characters";
import { isShowoff, type ShowcasePlayer } from "../shared/showcase";
import styles from "./CharacterShowcase.module.css";

interface Actor { instance: CharacterInstance; mixer: THREE.AnimationMixer; action?: THREE.AnimationAction; emote: string; char: number; team: number }
interface Member { id: string; char: number; team: number }
interface Spot { id: string; team: number; x: number; y: number; z: number; row: 0 | 1 }
/** How much a name tag may show: callsign and details, callsign only, or callsign on alternating lines. */
export type TagMode = "full" | "name" | "stagger";
interface Tag { id: string; left: number; top: number; row: 0 | 1; width: number; line: 0 | 1 }

/** Head height including hair, plus a little headroom for raised arms. */
const HEIGHT = 1.9;
const BACK_Z = -0.95;
const RISER = 0.28;
const HEADING = 40;
const TAG_HEIGHT: Record<TagMode, number> = { full: 36, name: 16, stagger: 30 };
const PAD_COLORS = ["#c4dc98", "#66b8ff", "#ff827c"];

/**
 * Up to six stand in one row. Larger rooms zig-zag across a front row and a raised back row,
 * half a slot apart so every face shows; the caller orders Blue before Red so teams stay grouped.
 */
function formation(members: Member[]) {
  const rows = members.length > 6 ? 2 : 1;
  const slot = rows === 1 ? 1.55 : members.length > 14 ? 1.05 : 1.2;
  const step = rows === 1 ? slot : slot / 2;
  const gap = rows === 1 ? 0.45 : 0.3;
  let x = 0;
  const spots = members.map((member, k): Spot => {
    const before = members[k - 1];
    if (before && member.team > 0 && before.team > 0 && member.team !== before.team) x += gap;
    const back = rows === 2 && k % 2 === 1;
    const spot: Spot = { id: member.id, team: member.team, x, y: back ? RISER : 0, z: back ? BACK_Z : 0, row: back ? 1 : 0 };
    x += step;
    return spot;
  });
  const shift = spots.length ? (spots[0].x + spots[spots.length - 1].x) / 2 : 0;
  for (const spot of spots) spot.x -= shift;
  return { spots, rows, slot };
}

/** One small renderer for the whole party; no physics, HDR, shadows or postprocessing. */
/** Radians the rangers turn per pixel dragged: a full turn over roughly the stage width. */
const TURN_PER_PIXEL = 0.012;

export default function CharacterStage({ players, paused, label }: {
  players: ShowcasePlayer[]; paused: boolean; label: (player: ShowcasePlayer, mode: TagMode) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const tagLayer = useRef<HTMLDivElement>(null);
  const latest = useRef({ players, paused });
  const stage = useRef<{ setRoster(members: Member[]): void } | null>(null);
  const [status, setStatus] = useState("Loading characters…");
  const [retry, setRetry] = useState(0);
  const [tags, setTags] = useState<{ mode: TagMode; list: Tag[] }>({ mode: "full", list: [] });
  useEffect(() => { latest.current = { players, paused }; }, [players, paused]);
  const roster = JSON.stringify(players.map(({ id, char, team }) => ({ id, char, team })));

  useEffect(() => {
    const container = host.current!;
    let disposed = false;
    let frame = 0;
    let visible = true;
    let dirty = true;
    let previous = 0;
    let generation = 0;
    let lineup = formation([]);
    let published = "";
    const actors = new Map<string, Actor>();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      queueMicrotask(() => { if (!disposed) setStatus("3D preview unavailable. You can still choose a showoff and play."); });
      return () => { disposed = true; };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    container.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xd8edff, 0x5b6446, 2.6));
    const key = new THREE.DirectionalLight(0xffead0, 3.5);
    key.position.set(2, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xb5d9ff, 2);
    rim.position.set(-3, 2, -2); scene.add(rim);

    // Pads and the back-row riser share one geometry each, scaled per slot.
    const padGeometry = new THREE.CircleGeometry(1, 32);
    const padMaterials = PAD_COLORS.map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
    const pads = new THREE.Group();
    scene.add(pads);
    const riserGeometry = new THREE.BoxGeometry(1, 1, 1);
    const riserMaterial = new THREE.MeshLambertMaterial({ color: "#2a3a2d" });
    const riser = new THREE.Mesh(riserGeometry, riserMaterial);
    riser.visible = false; scene.add(riser);

    const point = new THREE.Vector3();
    const project = (x: number, y: number, z: number) => point.set(x, y, z).project(camera);
    /** Fits the camera so the whole formation, plus its name tags, fits inside the viewport. */
    const fit = (width: number, height: number, mode: TagMode) => {
      const { spots, rows } = lineup;
      // A squeezed stage hides the heading and tags (see the container query), so it needs no room for them.
      const squeezed = !!tagLayer.current && getComputedStyle(tagLayer.current).display === "none";
      const tag = squeezed ? 0 : TAG_HEIGHT[mode];
      let top = (squeezed ? 4 : HEADING) + (rows === 2 && tag ? tag + 6 : 0);
      let bottom = tag + 10;
      const side = 14;
      // Tiny stages keep at least half their height for the characters.
      const room = height * 0.5;
      if (height - top - bottom < room) { const scale = Math.max(0, height - room) / (top + bottom); top *= scale; bottom *= scale; }
      const safeW = 2 - (4 * side) / width, safeH = 2 - (2 * (top + bottom)) / height;
      const xs = spots.map((s) => s.x), zs = spots.map((s) => s.z);
      const minX = Math.min(...xs, 0) - 0.4, maxX = Math.max(...xs, 0) + 0.4;
      const minZ = Math.min(...zs, 0), maxZ = Math.max(...zs, 0);
      const maxY = HEIGHT + (rows === 2 ? RISER : 0);
      const center = new THREE.Vector3((minX + maxX) / 2, maxY / 2, (minZ + maxZ) / 2);
      const direction = new THREE.Vector3(0, rows === 2 ? 0.22 : 0.1, 1).normalize();
      const corners = spots.flatMap((s) => [-0.4, 0.4].flatMap((dx) => [[s.x + dx, s.y, s.z], [s.x + dx, s.y + HEIGHT, s.z]]));
      if (!corners.length) corners.push([0, 0, 0], [0, HEIGHT, 0]);
      // Leave room for the outermost name tags, which are a full slot wide.
      else if (spots.length > 1) corners.push([minX + 0.4 - lineup.slot / 2, 0, 0], [maxX - 0.4 + lineup.slot / 2, 0, 0]);
      const place = (distance: number, lift: number) => {
        camera.position.copy(center).addScaledVector(direction, distance); camera.position.y += lift;
        camera.lookAt(center.x, center.y + lift, center.z); camera.updateMatrixWorld();
      };
      const extents = () => {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, y, z] of corners) {
          const p = project(x, y, z);
          // Behind the camera or past the far plane: never counts as a fit.
          if (p.z < -1 || p.z > 1) return { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity };
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        return { x0, x1, y0, y1 };
      };
      let near = 1, far = 300;
      for (let i = 0; i < 24; i++) {
        const mid = (near + far) / 2;
        place(mid, 0);
        const e = extents();
        if (e.x1 - e.x0 <= safeW && e.y1 - e.y0 <= safeH) far = mid; else near = mid;
      }
      // A single ranger keeps the familiar portrait framing instead of filling the stage.
      const distance = Math.max(far, 4.6);
      // Centre the formation between the heading/back tags and the front tags.
      const want = (1 - (2 * top) / height + (-1 + (2 * bottom) / height)) / 2;
      let lift = 0;
      for (let i = 0; i < 2; i++) {
        place(distance, lift);
        const e = extents();
        lift -= (want - (e.y0 + e.y1) / 2) * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      }
      place(distance, lift);
    };
    /** Sizes the canvas, frames the formation and works out where each name tag goes. */
    const layout = () => {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return null;
      renderer.setSize(width, height);
      camera.aspect = width / height; camera.updateProjectionMatrix();
      const { spots, slot } = lineup;
      const slotPx = (s: Spot) => {
        if (spots.length < 2) return 240;
        const a = project(s.x - slot / 2, s.y, s.z).x, b = project(s.x + slot / 2, s.y, s.z).x;
        return Math.min(240, (Math.abs(b - a) / 2) * width);
      };
      const choose = (px: number): TagMode => px >= 124 ? "full" : px >= 62 ? "name" : "stagger";
      // Frame for full tags first; if slots come out too narrow, reframe once for the shorter tags.
      let mode: TagMode = "full";
      fit(width, height, mode);
      const shorter = choose(Math.min(240, ...spots.map(slotPx)));
      if (shorter !== mode) { mode = shorter; fit(width, height, mode); }
      dirty = true;
      const rowIndex = [0, 0];
      const list = spots.map((s): Tag => {
        const px = slotPx(s);
        // `project` reuses one vector, so read the anchor after measuring the slot.
        const anchor = project(s.x, s.row ? s.y + HEIGHT : s.y, s.z);
        const line = (rowIndex[s.row]++ % 2) as 0 | 1;
        const left = Math.round(((anchor.x + 1) / 2) * width);
        return {
          id: s.id, row: s.row, line: mode === "stagger" ? line : 0,
          left, top: Math.round(((1 - anchor.y) / 2) * height),
          // Edge tags shrink rather than spill off the stage.
          width: Math.floor(Math.min(mode === "stagger" ? px * 2 - 6 : px - 6, 2 * (left - 4), 2 * (width - 4 - left))),
        };
      });
      return { mode, list };
    };
    const publish = (next: ReturnType<typeof layout>) => {
      if (!next || disposed) return;
      const text = JSON.stringify(next);
      if (text !== published) { published = text; setTags(next); }
    };
    const resizeObserver = new ResizeObserver(() => publish(layout()));
    resizeObserver.observe(container); layout();
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; dirty = true; previous = 0; });
    observer.observe(container);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const invalidate = () => { dirty = true; previous = 0; };
    motion.addEventListener("change", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    const lost = (event: Event) => {
      event.preventDefault(); cancelAnimationFrame(frame);
      setStatus("3D preview paused. Retry to restore it; your room is still connected.");
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    // Drag (or arrow keys) turns every ranger in place to show their back; double-click faces them forward again.
    let turn = 0, dragging: number | null = null, lastX = 0;
    const applyTurn = () => { for (const actor of actors.values()) actor.instance.root.rotation.y = turn; dirty = true; };
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Animated character preview. Drag or use the arrow keys to turn the characters around.");
    const down = (e: PointerEvent) => { if (e.button !== 0) return; dragging = e.pointerId; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); canvas.dataset.dragging = ""; };
    const move = (e: PointerEvent) => {
      if (dragging !== e.pointerId) return;
      turn += (e.clientX - lastX) * TURN_PER_PIXEL; lastX = e.clientX; applyTurn();
    };
    const up = (e: PointerEvent) => { if (dragging !== e.pointerId) return; dragging = null; delete canvas.dataset.dragging; };
    const reset = () => { turn = 0; applyTurn(); };
    const turnKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); turn += e.key === "ArrowLeft" ? -0.3 : 0.3; applyTurn();
    };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("dblclick", reset); canvas.addEventListener("keydown", turnKey);
    const releaseActor = ({ instance, mixer }: Actor) => {
      mixer.stopAllAction(); mixer.uncacheRoot(instance.root);
      instance.root.removeFromParent();
      for (const skeleton of new Set(instance.meshes.map((mesh) => mesh.skeleton))) skeleton.dispose();
      // Geometry, textures and team materials belong to the shared asset cache.
    };
    const arrange = () => {
      pads.clear();
      const radius = Math.min(0.55, lineup.slot * 0.42);
      for (const spot of lineup.spots) {
        const actor = actors.get(spot.id);
        actor?.instance.root.position.set(spot.x, spot.y, spot.z);
        if (actor) actor.instance.root.rotation.y = turn;
        const pad = new THREE.Mesh(padGeometry, padMaterials[spot.team === 1 || spot.team === 2 ? spot.team : 0]);
        pad.rotation.x = -Math.PI / 2; pad.scale.setScalar(radius);
        pad.position.set(spot.x, spot.y + 0.005, spot.z);
        pads.add(pad);
      }
      const back = lineup.spots.filter((s) => s.row === 1);
      riser.visible = back.length > 0;
      if (back.length) {
        const left = back[0].x - lineup.slot * 0.6, right = back[back.length - 1].x + lineup.slot * 0.6;
        riser.scale.set(right - left, RISER, 0.95);
        riser.position.set((left + right) / 2, RISER / 2, BACK_Z);
      }
      dirty = true;
    };
    /** Keeps everyone already on stage and only instantiates newcomers, so joins never rebuild the scene. */
    async function setRoster(members: Member[]) {
      const current = ++generation;
      lineup = formation(members);
      for (const [id, actor] of actors) {
        const member = members.find((m) => m.id === id);
        if (!member || member.char !== actor.char || member.team !== actor.team) { releaseActor(actor); actors.delete(id); }
      }
      const missing = members.filter((m) => !actors.has(m.id));
      arrange();
      publish(layout());
      if (!missing.length) { setStatus(""); return; }
      if (!actors.size) setStatus("Loading characters…");
      try {
        const templates = await Promise.all(missing.map((m) => loadLobbyCharacter(m.char)));
        if (disposed || current !== generation) return;
        templates.forEach((template, i) => {
          const member = missing[i];
          const instance = instantiateCharacter(template, member.team, member.char === 0);
          scene.add(instance.root);
          const mixer = new THREE.AnimationMixer(instance.root);
          const requested = latest.current.players.find((p) => p.id === member.id)?.emote;
          const emote = isShowoff(requested) ? requested : "idle";
          const action = mixer.clipAction(template.full.get(emote)!).play();
          // Stagger the loops so a big lineup does not move in lockstep.
          action.time = (i * 0.37) % Math.max(0.01, action.getClip().duration);
          mixer.update(0);
          actors.set(member.id, { instance, mixer, action, emote, char: member.char, team: member.team });
        });
        arrange();
        setStatus("");
      } catch {
        if (!disposed && current === generation) setStatus("Characters could not load. Retry the preview or continue to your match.");
      }
    }
    stage.current = { setRoster: (members) => void setRoster(members) };
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || !visible) { previous = 0; return; }
      if (previous && time - previous < 1000 / 30) return;
      const dt = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
      previous = time;
      const still = latest.current.paused || motion.matches;
      for (const member of latest.current.players) {
        const actor = actors.get(member.id);
        if (!actor) continue;
        const emote = isShowoff(member.emote) ? member.emote : "idle";
        if (actor.emote !== emote) {
          const next = actor.mixer.clipAction(actor.instance.template.full.get(emote)!);
          const old = actor.action;
          next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
          if (still) { old?.stop(); }
          else if (old) { old.fadeOut(0.2); next.fadeIn(0.2); }
          actor.action = next; actor.emote = emote;
          actor.mixer.update(0); dirty = true;
        }
        if (!still) { actor.mixer.update(dt); dirty = true; }
      }
      if (dirty) { renderer.render(scene, camera); dirty = false; }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true; cancelAnimationFrame(frame); stage.current = null;
      resizeObserver.disconnect(); observer.disconnect();
      motion.removeEventListener("change", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("dblclick", reset); canvas.removeEventListener("keydown", turnKey);
      actors.forEach(releaseActor);
      for (const resource of [padGeometry, riserGeometry, riserMaterial, ...padMaterials]) resource.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [retry]);

  useEffect(() => { stage.current?.setRoster(JSON.parse(roster) as Member[]); }, [roster, retry]);

  const byId = new Map(players.map((p) => [p.id, p]));
  return <div className={styles.viewport} data-stage-status={status ? "loading" : "ready"} data-stage-players={players.length}>
    <div className={styles.canvasHost} ref={host} />
    <div className={styles.tags} ref={tagLayer} data-mode={tags.mode}>{tags.list.map((tag) => {
      const player = byId.get(tag.id);
      if (!player) return null;
      const style = { left: tag.left, top: tag.top, width: tag.width, "--line": tag.line } as CSSProperties;
      return <div key={tag.id} className={styles.tag} data-row={tag.row} data-team={player.team} style={style}>{label(player, tags.mode)}</div>;
    })}</div>
    {status && <div className={styles.notice} role="status">{status}{!status.startsWith("Loading") && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry preview</button>}</div>}
  </div>;
}
