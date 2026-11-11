"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useSettings, type Quality } from "./settings";

/**
 * The pre-match backdrop: a contour-mapped terrain flowing slowly toward the camera, with a sonar
 * ring that sweeps out across the ground.
 *
 * Built to cost next to nothing on office PCs: one draw call, no textures, lights, shadows or
 * post-processing, a reduced render scale and a 30 fps cap. It stops while the tab is hidden and
 * holds a single still frame under reduced motion.
 */

/** Render scale per graphics tier. The scene is soft and foggy, so it holds up well below native. */
const RENDER_SCALE: Record<Quality, number> = { low: 0.7, medium: 0.85, high: 1, ultra: 1 };
const FRAME_MS = 1000 / 30;
/** World units the terrain travels per second. */
const FLOW_SPEED = 1.5;
/** How far a sonar ring runs before it has faded out, and how fast. */
const PULSE_REACH = 150;
const PULSE_SPEED = 34;
/** Seconds between the idle rings. */
const PULSE_EVERY = 9;
/** Where the scene is frozen for players who asked for reduced motion. */
const STILL_TIME = 14;

/**
 * Ground height, shared by both shader stages: the mesh is displaced by it, and the contour lines
 * are worked out from it again per pixel, so they come out as smooth curves, not the mesh's facets.
 */
const HEIGHT = /* glsl */ `
  uniform float uValley;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 3; i++) { sum += amp * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); amp *= 0.5; }
    return sum;
  }
  // field: a point of the scrolling noise field. across: its distance from the centre line.
  float ground(vec2 field, float across) {
    float rolling = fbm(field * 0.028);
    float ridge = 1.0 - abs(2.0 * vnoise(field * 0.012 + 40.0) - 1.0);
    // A flat corridor runs down the middle, so the hills frame the operator instead of burying them.
    float valley = smoothstep(uValley * 0.14, uValley, abs(across));
    return (rolling * 0.8 + ridge * ridge * 0.55) * mix(0.1, 1.0, valley) * 17.0 - 2.5;
  }
`;

const TERRAIN_VERTEX = /* glsl */ `
  uniform float uFlow;
  varying vec2 vField;
  varying vec2 vGround;
  varying float vAcross;
  varying float vDepth;
  ${HEIGHT}
  void main() {
    vec3 p = position;
    // The noise field slides toward the camera; the mesh itself never moves.
    vField = vec2(p.x, p.z - uFlow);
    vAcross = p.x;
    p.y = ground(vField, p.x);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vGround = world.xz;
    vec4 view = viewMatrix * world;
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const TERRAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uFill;
  uniform vec3 uLine;
  uniform vec3 uAccent;
  uniform vec2 uPulse; // radius, strength
  uniform vec2 uPulseAt;
  uniform float uFar;
  varying vec2 vField;
  varying vec2 vGround;
  varying float vAcross;
  varying float vDepth;
  ${HEIGHT}
  // An anti-aliased line wherever v crosses a whole number; it fades out before it can shimmer.
  float isoline(float v, float width) {
    float w = fwidth(v);
    float d = abs(fract(v - 0.5) - 0.5);
    return (1.0 - smoothstep(w * width * 0.5, w * (width * 0.5 + 1.0), d)) * (1.0 - smoothstep(0.22, 0.55, w));
  }
  void main() {
    float height = ground(vField, vAcross);
    float minor = isoline(height / 0.8, 1.0);
    float major = isoline(height / 4.0, 1.6);
    vec2 cell = vField / 7.0;
    float grid = max(isoline(cell.x, 1.0), isoline(cell.y, 1.0));
    float peak = smoothstep(0.0, 12.0, height);
    vec3 color = uFill * (0.45 + 0.9 * peak);
    color += uLine * (minor * 0.3 + major * 0.8 + grid * 0.12) * (0.5 + 0.6 * peak);
    // The sonar ring lights whatever lines it passes over.
    float ring = exp(-pow((distance(vGround, uPulseAt) - uPulse.x) / 2.4, 2.0)) * uPulse.y;
    color += uAccent * ring * (0.1 + minor * 0.6 + major * 1.0 + grid * 0.45);
    // Fades into the sky at the horizon, and out again right under the camera.
    float alpha = (1.0 - smoothstep(uFar * 0.22, uFar, vDepth)) * smoothstep(1.0, 12.0, vDepth);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

interface Backdrop { canvas: HTMLCanvasElement; pulse(): void; dispose(): void }

function createBackdrop(): Backdrop | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
  } catch {
    return null; // No WebGL: the CSS gradient underneath is the backdrop.
  }
  const canvas = renderer.domElement;
  canvas.dataset.backdrop = "";
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 1, 400);
  const target = new THREE.Vector3(0, 4.2, -40);

  // The shader writes straight to the canvas, so these are taken as display values, not converted to linear.
  const display = (hex: number) => ({ value: new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace) });
  const geometry = new THREE.PlaneGeometry(260, 170, 130, 85);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERTEX, fragmentShader: TERRAIN_FRAGMENT, transparent: true, premultipliedAlpha: true,
    uniforms: {
      uFill: display(0x0b1620), uLine: display(0x5d94a8), uAccent: display(0xc8f751),
      uFlow: { value: 0 }, uValley: { value: 44 }, uFar: { value: 150 },
      uPulse: { value: new THREE.Vector2(0, 0) }, uPulseAt: { value: new THREE.Vector2(0, -8) },
    },
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.position.z = -52;
  terrain.frustumCulled = false;
  scene.add(terrain);

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, previous = 0, clock = 0, dirty = true, lost = false, shown = false;
  let width = 0, height = 0, scale = 0;
  let pulseAge = 0.6, sincePulse = 0;
  const pointer = { x: 0, y: 0 }, eased = { x: 0, y: 0 };

  /** Matches the drawing buffer to the canvas's CSS box and the chosen graphics tier. */
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const next = RENDER_SCALE[useSettings.getState().quality] * Math.min(window.devicePixelRatio || 1, 1.25);
    if (!w || !h || (w === width && h === height && next === scale)) return;
    width = w; height = h; scale = next;
    renderer.setPixelRatio(scale);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Narrow screens pull the hills in, or a phone would only ever see the flat corridor.
    material.uniforms.uValley.value = THREE.MathUtils.clamp(camera.aspect * 26, 14, 48);
    dirty = true;
  };

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (document.hidden || lost || !canvas.isConnected) { previous = 0; return; }
    if (previous && now - previous < FRAME_MS - 1) return;
    const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 0;
    previous = now;
    resize();
    if (motion.matches) {
      if (!dirty) return;
      clock = STILL_TIME; pulseAge = 1.4; eased.x = eased.y = 0;
    } else {
      clock += dt;
      pulseAge += dt; sincePulse += dt;
      if (sincePulse > PULSE_EVERY) { pulseAge = 0; sincePulse = 0; }
      eased.x += (pointer.x - eased.x) * Math.min(1, dt * 2.2);
      eased.y += (pointer.y - eased.y) * Math.min(1, dt * 2.2);
    }
    material.uniforms.uFlow.value = clock * FLOW_SPEED;
    const radius = pulseAge * PULSE_SPEED;
    material.uniforms.uPulse.value.set(radius, Math.max(0, 1 - radius / PULSE_REACH) ** 1.6);
    // A slow sway of its own, plus a little parallax from the pointer.
    camera.position.set(Math.sin(clock * 0.09) * 1.6 + eased.x * 3.2, 7.6 + Math.sin(clock * 0.13) * 0.35 - eased.y * 1.1, 28);
    camera.lookAt(target);
    renderer.render(scene, camera);
    dirty = false;
    if (!shown) { shown = true; canvas.dataset.ready = ""; }
  };

  const point = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const invalidate = () => { dirty = true; previous = 0; };
  const contextLost = (e: Event) => { e.preventDefault(); lost = true; delete canvas.dataset.ready; };
  const contextRestored = () => { lost = false; shown = false; invalidate(); };
  window.addEventListener("pointermove", point, { passive: true });
  window.addEventListener("resize", invalidate);
  motion.addEventListener("change", invalidate);
  document.addEventListener("visibilitychange", invalidate);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  const unsubscribe = useSettings.subscribe(invalidate);
  frame = requestAnimationFrame(tick);

  return {
    canvas,
    pulse() { pulseAge = 0; sincePulse = 0; dirty = true; },
    dispose() {
      cancelAnimationFrame(frame);
      unsubscribe();
      window.removeEventListener("pointermove", point);
      window.removeEventListener("resize", invalidate);
      motion.removeEventListener("change", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      geometry.dispose(); material.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}

/**
 * One backdrop is shared by the home lobby and the waiting room: going from one to the other moves
 * the same canvas across instead of building a second WebGL context, and it is only torn down once
 * neither screen is showing (so the match gets the GPU to itself).
 */
let shared: Backdrop | null = null;
let users = 0;
let teardown = 0;

function acquire(host: HTMLElement) {
  window.clearTimeout(teardown);
  users++;
  shared ??= createBackdrop();
  if (shared) host.appendChild(shared.canvas);
}

function release() {
  users--;
  if (users > 0) return;
  teardown = window.setTimeout(() => { shared?.dispose(); shared = null; }, 500);
}

/** Fills its parent, behind everything else in it. A new `pulse` value sends out a sonar ring. */
export default function LobbyBackdrop({ pulse }: { pulse?: string | number | boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    acquire(host.current!);
    return release;
  }, []);
  useEffect(() => { shared?.pulse(); }, [pulse]);
  return <div ref={host} className="lobby-backdrop" aria-hidden="true" />;
}
