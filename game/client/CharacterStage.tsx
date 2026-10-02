"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { instantiateCharacter, loadLobbyCharacter, type CharacterInstance } from "./assets/characters";
import { isShowoff, type ShowcasePlayer } from "../shared/showcase";
import styles from "./CharacterShowcase.module.css";

interface Actor { instance: CharacterInstance; mixer: THREE.AnimationMixer; action?: THREE.AnimationAction; emote: string }

/** One small renderer for the visible party; no physics, HDR, shadows or postprocessing. */
export default function CharacterStage({ players, paused }: { players: ShowcasePlayer[]; paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ players, paused });
  const [status, setStatus] = useState("Loading characters…");
  const [retry, setRetry] = useState(0);
  useEffect(() => { latest.current = { players, paused }; }, [players, paused]);
  const roster = JSON.stringify(players.map(({ id, char, team }) => ({ id, char, team })));

  useEffect(() => {
    const container = host.current!;
    const members = JSON.parse(roster) as ShowcasePlayer[];
    let disposed = false;
    let frame = 0;
    let visible = true;
    let dirty = true;
    let previous = 0;
    const actors = new Map<string, Actor>();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    const owned: { dispose(): void }[] = [];
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
    renderer.domElement.setAttribute("aria-label", "Animated character preview");
    renderer.domElement.setAttribute("role", "img");
    container.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xd8edff, 0x5b6446, 2.6));
    const key = new THREE.DirectionalLight(0xffead0, 3.5);
    key.position.set(2, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xb5d9ff, 2);
    rim.position.set(-3, 2, -2); scene.add(rim);
    const resize = () => {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      // Frame the full lineup even on narrow phones.
      const halfWidth = Math.max(0.7, members.length * 0.78);
      const distance = Math.max(4.6, halfWidth / (Math.tan(THREE.MathUtils.degToRad(16)) * camera.aspect));
      camera.position.set(0, 1.35, distance);
      camera.lookAt(0, 1, 0); camera.updateProjectionMatrix(); dirty = true;
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container); resize();
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
    const releaseActor = ({ instance, mixer }: Actor) => {
      mixer.stopAllAction(); mixer.uncacheRoot(instance.root);
      instance.root.removeFromParent();
      for (const skeleton of new Set(instance.meshes.map((mesh) => mesh.skeleton))) skeleton.dispose();
      // Geometry, textures and team materials belong to the shared asset cache.
    };
    async function load() {
      setStatus("Loading characters…");
      try {
        const templates = await Promise.all(members.map((p) => loadLobbyCharacter(p.char)));
        if (disposed) return;
        templates.forEach((template, i) => {
          const member = members[i];
          const instance = instantiateCharacter(template, member.team, member.char === 0);
          instance.root.position.x = (i - (members.length - 1) / 2) * 1.55;
          scene.add(instance.root);
          const mixer = new THREE.AnimationMixer(instance.root);
          const requested = latest.current.players.find((p) => p.id === member.id)?.emote;
          const emote = isShowoff(requested) ? requested : "idle";
          const action = mixer.clipAction(template.full.get(emote)!).play();
          mixer.update(0);
          actors.set(member.id, { instance, mixer, action, emote });
          const geometry = new THREE.CircleGeometry(0.55, 40);
          const material = new THREE.MeshBasicMaterial({ color: member.team === 1 ? "#66b8ff" : member.team === 2 ? "#ff827c" : "#c4dc98", transparent: true, opacity: 0.16 });
          const pad = new THREE.Mesh(geometry, material);
          pad.rotation.x = -Math.PI / 2; pad.position.set(instance.root.position.x, 0.005, 0);
          scene.add(pad); owned.push(geometry, material);
        });
        setStatus(""); dirty = true;
      } catch {
        if (!disposed) setStatus("Characters could not load. Retry the preview or continue to your match.");
      }
    }
    void load();
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || !visible) { previous = 0; return; }
      if (previous && time - previous < 1000 / 30) return;
      const dt = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
      previous = time;
      for (const member of latest.current.players) {
        const actor = actors.get(member.id);
        if (!actor) continue;
        const emote = isShowoff(member.emote) ? member.emote : "idle";
        if (actor.emote !== emote) {
          const next = actor.mixer.clipAction(actor.instance.template.full.get(emote)!);
          const old = actor.action;
          next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
          if (latest.current.paused || motion.matches) { old?.stop(); }
          else if (old) { old.fadeOut(0.2); next.fadeIn(0.2); }
          actor.action = next; actor.emote = emote;
          actor.mixer.update(0); dirty = true;
        }
        if (!latest.current.paused && !motion.matches) { actor.mixer.update(dt); dirty = true; }
      }
      if (dirty) { renderer.render(scene, camera); dirty = false; }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      resizeObserver.disconnect(); observer.disconnect();
      motion.removeEventListener("change", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      actors.forEach(releaseActor); owned.forEach((resource) => resource.dispose());
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [roster, retry]);

  return <div className={styles.viewport} data-stage-status={status ? "loading" : "ready"}>
    <div className={styles.canvasHost} ref={host} />
    {status && <div className={styles.notice} role="status">{status}{!status.startsWith("Loading") && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry preview</button>}</div>}
  </div>;
}
