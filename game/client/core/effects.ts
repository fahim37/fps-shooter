import * as THREE from "three";
import type { Quality } from "../settings";
import { Casings, type CasingKind } from "./casings";

// ---------------------------------------------------------------- procedural textures

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softDot(g: CanvasRenderingContext2D, s: number) {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.55)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
}

function smokePuff(g: CanvasRenderingContext2D, s: number) {
  for (let i = 0; i < 22; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.4, y = s / 2 + (Math.random() - 0.5) * s * 0.4;
    const r = s * (0.12 + Math.random() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

function flashStar(g: CanvasRenderingContext2D, s: number) {
  g.translate(s / 2, s / 2);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  glow.addColorStop(0, "rgba(255,250,220,1)");
  glow.addColorStop(0.2, "rgba(255,200,90,0.9)");
  glow.addColorStop(0.55, "rgba(255,120,20,0.25)");
  glow.addColorStop(1, "rgba(255,80,0,0)");
  g.fillStyle = glow;
  g.fillRect(-s / 2, -s / 2, s, s);
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
    const len = s * (0.3 + Math.random() * 0.2);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, "rgba(255,240,200,0.95)");
    grad.addColorStop(1, "rgba(255,150,40,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -s * 0.03);
    g.lineTo(len, 0);
    g.lineTo(0, s * 0.03);
    g.fill();
  }
}

function bulletHole(g: CanvasRenderingContext2D, s: number) {
  const c = s / 2;
  const scorch = g.createRadialGradient(c, c, 0, c, c, c);
  scorch.addColorStop(0, "rgba(10,8,6,0.95)");
  scorch.addColorStop(0.22, "rgba(20,16,12,0.9)");
  scorch.addColorStop(0.45, "rgba(40,32,24,0.35)");
  scorch.addColorStop(1, "rgba(40,32,24,0)");
  g.fillStyle = scorch;
  g.fillRect(0, 0, s, s);
  g.strokeStyle = "rgba(20,15,10,0.6)";
  g.lineWidth = s * 0.02;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, l = s * (0.18 + Math.random() * 0.2);
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a) * l, c + Math.sin(a) * l);
    g.stroke();
  }
}

function bloodDrop(g: CanvasRenderingContext2D, s: number) {
  const c = s / 2;
  const grad = g.createRadialGradient(c, c, s * 0.1, c, c, s * 0.43);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.96)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(c, c, s * 0.4, s * 0.47, -0.35, 0, Math.PI * 2);
  g.fill();
}

function bloodStain(g: CanvasRenderingContext2D, s: number) {
  const c = s / 2;
  g.fillStyle = "rgba(255,255,255,0.88)";
  g.beginPath();
  for (let i = 0; i <= 30; i++) {
    const a = i / 30 * Math.PI * 2;
    const r = s * (0.16 + Math.random() * 0.09);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = s * (0.2 + Math.random() * 0.26);
    g.globalAlpha = 0.5 + Math.random() * 0.5;
    g.beginPath();
    g.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, s * (0.008 + Math.random() * 0.028), s * (0.01 + Math.random() * 0.035), a, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Wind streaks for a dash's ribbon: they run along it, thickest through the middle, and tile end to end. */
function windStreaks(g: CanvasRenderingContext2D, s: number) {
  // A body of pale blue, which shows against light walls and sky where white alone would not.
  const band = g.createLinearGradient(0, 0, 0, s);
  band.addColorStop(0, "rgba(95,190,255,0)");
  band.addColorStop(0.3, "rgba(95,190,255,0.5)");
  band.addColorStop(0.7, "rgba(95,190,255,0.5)");
  band.addColorStop(1, "rgba(95,190,255,0)");
  g.fillStyle = band;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const y = s * (0.5 + (Math.random() + Math.random() - 1) * 0.4);
    const h = s * (0.03 + Math.random() * 0.07);
    const len = s * (0.35 + Math.random() * 0.5), x = Math.random() * s;
    const alpha = 0.6 + Math.random() * 0.4;
    // Drawn twice, a tile apart, so a streak crossing the edge carries on at the other side.
    for (const x0 of [x, x - s]) {
      const grad = g.createLinearGradient(x0, 0, x0 + len, 0);
      grad.addColorStop(0, "rgba(215,242,255,0)");
      grad.addColorStop(0.7, `rgba(215,242,255,${alpha})`);
      grad.addColorStop(1, "rgba(215,242,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x0 + len / 2, y, len / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// ---------------------------------------------------------------- particles

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  r: number; g: number; b: number;
  a0: number;
  grav: number;
  drag: number;
}

const PARTICLE_VS = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uViewportHeight;
  varying vec4 vColor;
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (projectionMatrix[1][1] * 0.5) * (1.0 / -mvPosition.z) * uViewportHeight;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const PARTICLE_FS = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * tex.a);
    if (gl_FragColor.a < 0.01) discard;
    #include <fog_fragment>
  }
`;

/** CPU-simulated billboard particles drawn as one Points call. */
class ParticleSystem {
  readonly points: THREE.Points;
  private particles: Particle[] = [];
  private free: Particle[] = [];
  private recycleIndex = 0;
  private limit: number;
  private pos: Float32Array;
  private size: Float32Array;
  private color: Float32Array;
  private geom: THREE.BufferGeometry;

  constructor(max: number, map: THREE.Texture, additive: boolean) {
    this.limit = max;
    // Reuse simulation objects, including when sustained fire fills the budget.
    for (let i = 0; i < max; i++) this.free.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 0, s0: 0, s1: 0, r: 0, g: 0, b: 0, a0: 0, grav: 0, drag: 0 });
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute("aColor", new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    this.geom.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uViewportHeight: { value: 1000 }, ...THREE.UniformsLib.fog },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this.points.visible = false;
  }

  setLimit(limit: number) {
    this.limit = Math.min(limit, this.size.length);
    while (this.particles.length > this.limit) this.free.push(this.particles.pop()!);
    this.recycleIndex = 0;
  }

  setViewportHeight(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uViewportHeight.value = h;
  }

  dispose() {
    const mat = this.points.material as THREE.ShaderMaterial;
    (mat.uniforms.uMap.value as THREE.Texture).dispose();
    mat.dispose();
    this.geom.dispose();
  }

  spawn(p: Omit<Particle, "life">) {
    if (this.limit === 0) return;
    let slot: Particle;
    if (this.particles.length < this.limit) {
      slot = this.free.pop()!;
      this.particles.push(slot);
    } else {
      this.recycleIndex %= this.particles.length;
      slot = this.particles[this.recycleIndex++];
    }
    Object.assign(slot, p);
    slot.life = 0;
  }

  update(dt: number) {
    const ps = this.particles;
    if (ps.length === 0) {
      this.points.visible = false;
      return;
    }
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) { this.free.push(p); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.life / p.max;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.size[n] = p.s0 + (p.s1 - p.s0) * t;
      this.color[n * 4] = p.r; this.color[n * 4 + 1] = p.g; this.color[n * 4 + 2] = p.b;
      this.color[n * 4 + 3] = p.a0 * (1 - t) * Math.min(1, p.life * 30);
      ps[n++] = p;
    }
    ps.length = n;
    this.points.visible = n > 0;
    this.geom.setDrawRange(0, n);
    for (const a of ["position", "aSize", "aColor"]) (this.geom.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface EffectBudget {
  smoke: number; glow: number; blood: number;
  density: number; tracers: number; flashes: number; decals: number; bloodDecals: number;
  /** Spent cases lying about at once. */
  casings: number;
  lights: boolean;
}

const EFFECT_BUDGETS: Record<Quality, EffectBudget> = {
  low: { smoke: 140, glow: 90, blood: 64, density: 0.35, tracers: 16, flashes: 8, decals: 40, bloodDecals: 12, casings: 6, lights: false },
  medium: { smoke: 320, glow: 180, blood: 120, density: 0.65, tracers: 32, flashes: 16, decals: 80, bloodDecals: 24, casings: 12, lights: false },
  high: { smoke: 700, glow: 400, blood: 200, density: 1, tracers: 48, flashes: 24, decals: 140, bloodDecals: 40, casings: 24, lights: true },
  ultra: { smoke: 900, glow: 500, blood: 260, density: 1.15, tracers: 64, flashes: 32, decals: 180, bloodDecals: 48, casings: 40, lights: true },
};

// ---------------------------------------------------------------- effects manager

interface Tracer {
  mesh: THREE.Mesh;
  trail: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  t: number;
}

interface Flash {
  sprite: THREE.Mesh;
  life: number;
}

/** A dash's wake at full density: streaks and puffs of air a second. */
const WAKE_STREAKS = 110, WAKE_PUFFS = 24;

/**
 * A dash's ribbon: a band of wind along the whole way the player went, turned to face the viewer,
 * so anyone watching can tell where they ended up. One per dash, from a small pool.
 */
interface Ribbon {
  mesh: THREE.Mesh;
  /** Whose dash this is; a ribbon still being laid is found again by it. */
  id: string;
  /** Points along the middle of the band (0 while unused). The last one follows the player until the dash ends. */
  n: number;
  points: Float32Array;
  /** Still being laid, and whether this frame added to it: a frame that does not ends it. */
  live: boolean;
  fed: boolean;
  /** Seconds since the dash ended. */
  age: number;
  strength: number;
}

/** Ribbons at once, the most points along one, and how far apart they are dropped (m). */
const RIBBONS = 8, RIBBON_POINTS = 20, RIBBON_SPACING = 0.8;
/** How wide a ribbon is where the dash ended and how high above the feet its middle runs (m). */
const RIBBON_WIDTH = 1.5, RIBBON_LIFT = 0.95;
/** Seconds a ribbon hangs in the air after the dash. It dissolves from where the dash began, so what is left points to where the player is. */
const RIBBON_LINGER = 1.5;
/** Metres of ribbon one tile of streaks covers, and tiles a second they blow along it after the player. */
const RIBBON_TILE = 4, RIBBON_DRIFT = 0.6;
/** How bright the ribbon's streaks are drawn: a little over full, so they stay pale once tone mapped. */
const RIBBON_GLOW = 1.2;
const _ribbonLength = new Float32Array(RIBBON_POINTS);
const _origin = new THREE.Vector3();

/** Tracers by who fired: your own, a teammate's, an enemy's. */
const TRACER_COLORS = { local: new THREE.Color(4, 3.2, 1.8), friendly: new THREE.Color(1.1, 2.7, 4), enemy: new THREE.Color(4, 1.55, 0.65) };

const _v = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const NEG_Z = new THREE.Vector3(0, 0, -1);

export class Effects {
  readonly group = new THREE.Group();
  private smoke: ParticleSystem;
  private glow: ParticleSystem;
  private droplets: ParticleSystem;
  private quality: Quality = "high";
  private budget = EFFECT_BUDGETS.high;
  private tracers: Tracer[] = [];
  private tracerPool: Tracer[] = [];
  private tracerIndex = 0;
  private tracerGeo = new THREE.CylinderGeometry(0.012, 0.006, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
  private tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.8), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  private flashes: Flash[] = [];
  private flashIndex = 0;
  private flashMat: THREE.MeshBasicMaterial;
  private flashGeo = new THREE.PlaneGeometry(1, 1);
  private light = new THREE.PointLight("#ffb56b", 0, 9, 2);
  private lightLife = 0;
  private boomLight = new THREE.PointLight("#ff9a4a", 0, 30, 2);
  private boomLife = 0;
  private decals: THREE.InstancedMesh;
  private decalIndex = 0;
  private decalCount = 0;
  private bloodDecals: THREE.InstancedMesh;
  private bloodDecalIndex = 0;
  private bloodDecalLives = new Float32Array(48);
  private bloodDecalMaxLives = new Float32Array(48);
  private bloodDecalOpacities = new Float32Array(48);
  private bloodDecalAlpha: THREE.InstancedBufferAttribute;
  private dummy = new THREE.Object3D();
  private casings = new Casings();
  private ribbons: Ribbon[] = [];
  private ribbonMat: THREE.MeshBasicMaterial;
  private ribbonTime = 0;

  constructor() {
    const dot = canvasTexture(64, softDot);
    const puff = canvasTexture(128, smokePuff);
    this.smoke = new ParticleSystem(900, puff, false);
    this.glow = new ParticleSystem(500, dot, true);
    this.droplets = new ParticleSystem(260, canvasTexture(64, bloodDrop), false);
    this.smoke.setLimit(this.budget.smoke);
    this.glow.setLimit(this.budget.glow);
    this.droplets.setLimit(this.budget.blood);
    this.group.add(this.smoke.points, this.glow.points, this.droplets.points, this.light, this.boomLight, this.casings.mesh);
    this.casings.setLimit(this.budget.casings);
    this.flashMat = new THREE.MeshBasicMaterial({
      map: canvasTexture(128, flashStar), color: new THREE.Color(3, 2.6, 2), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const decalMat = new THREE.MeshStandardMaterial({
      map: canvasTexture(64, bulletHole), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), decalMat, 180);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    this.group.add(this.decals);

    const bloodMat = new THREE.MeshBasicMaterial({
      map: canvasTexture(128, bloodStain), color: "#8c0711", transparent: true, opacity: 0.88,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    bloodMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aDecalOpacity;\nvarying float vDecalOpacity;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDecalOpacity = aDecalOpacity;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vDecalOpacity;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vDecalOpacity;");
    };
    bloodMat.customProgramCacheKey = () => "blood-surface-fade-v1";
    const bloodGeo = new THREE.PlaneGeometry(1, 1);
    this.bloodDecalAlpha = new THREE.InstancedBufferAttribute(this.bloodDecalOpacities, 1).setUsage(THREE.DynamicDrawUsage);
    bloodGeo.setAttribute("aDecalOpacity", this.bloodDecalAlpha);
    this.bloodDecals = new THREE.InstancedMesh(bloodGeo, bloodMat, 48);
    this.bloodDecals.count = this.budget.bloodDecals;
    this.bloodDecals.frustumCulled = false;
    this.bloodDecals.visible = false;
    this.bloodDecals.renderOrder = 1;
    this.group.add(this.bloodDecals);

    for (let i = 0; i < 32; i++) {
      const sprite = new THREE.Mesh(this.flashGeo, this.flashMat);
      sprite.visible = false;
      this.group.add(sprite);
      this.flashes.push({ sprite, life: 0 });
    }
    for (let i = 0; i < 64; i++) {
      const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
      const trail = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
      mesh.frustumCulled = false;
      trail.frustumCulled = false;
      mesh.visible = trail.visible = false;
      this.group.add(mesh, trail);
      this.tracerPool.push({ mesh, trail, from: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, t: 0 });
    }

    const streaks = canvasTexture(256, windStreaks);
    streaks.wrapS = THREE.RepeatWrapping;
    // Not additive: a pale glow vanishes against bright sand and sky, where a dash most needs to be seen.
    this.ribbonMat = new THREE.MeshBasicMaterial({ map: streaks, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const index: number[] = [];
    for (let i = 0; i < RIBBON_POINTS - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    for (let i = 0; i < RIBBONS; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RIBBON_POINTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(RIBBON_POINTS * 4), 2).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(RIBBON_POINTS * 8), 4).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(index);
      geo.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geo, this.ribbonMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.ribbons.push({ mesh, id: "", n: 0, points: new Float32Array(RIBBON_POINTS * 3), live: false, fed: false, age: 0, strength: 1 });
    }
  }

  /** Budgets switch immediately with the in-game graphics setting. */
  setQuality(quality: Quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.budget = EFFECT_BUDGETS[quality];
    this.smoke.setLimit(this.budget.smoke);
    this.glow.setLimit(this.budget.glow);
    this.droplets.setLimit(this.budget.blood);
    this.casings.setLimit(this.budget.casings);
    while (this.tracers.length > this.budget.tracers) {
      const tr = this.tracers.pop()!;
      tr.mesh.visible = tr.trail.visible = false;
      this.tracerPool.push(tr);
    }
    for (let i = this.budget.flashes; i < this.flashes.length; i++) {
      this.flashes[i].life = 0;
      this.flashes[i].sprite.visible = false;
    }
    this.flashIndex %= this.budget.flashes;
    this.decalCount = Math.min(this.decalCount, this.budget.decals);
    this.decalIndex %= this.budget.decals;
    this.decals.count = this.decalCount;
    this.bloodDecalIndex %= this.budget.bloodDecals;
    this.bloodDecals.count = this.budget.bloodDecals;
    for (let i = this.budget.bloodDecals; i < this.bloodDecalLives.length; i++) {
      this.bloodDecalLives[i] = this.bloodDecalOpacities[i] = 0;
    }
    this.bloodDecalAlpha.needsUpdate = true;
    this.light.visible = this.boomLight.visible = this.budget.lights;
    if (!this.budget.lights) this.light.intensity = this.boomLight.intensity = 0;
  }

  setViewportHeight(h: number) {
    this.smoke.setViewportHeight(h);
    this.glow.setViewportHeight(h);
    this.droplets.setViewportHeight(h);
  }

  dispose() {
    this.group.removeFromParent();
    this.smoke.dispose(); this.glow.dispose(); this.droplets.dispose(); this.casings.dispose();
    for (const tr of [...this.tracers, ...this.tracerPool]) {
      (tr.mesh.material as THREE.Material).dispose();
      (tr.trail.material as THREE.Material).dispose();
    }
    this.tracerGeo.dispose(); this.tracerMat.dispose();
    this.flashGeo.dispose(); this.flashMat.map?.dispose(); this.flashMat.dispose();
    this.decals.geometry.dispose();
    const mat = this.decals.material as THREE.MeshStandardMaterial;
    mat.map?.dispose(); mat.dispose(); this.decals.dispose();
    this.bloodDecals.geometry.dispose();
    const bloodMat = this.bloodDecals.material as THREE.MeshBasicMaterial;
    bloodMat.map?.dispose(); bloodMat.dispose(); this.bloodDecals.dispose();
    for (const r of this.ribbons) r.mesh.geometry.dispose();
    this.ribbonMat.map?.dispose(); this.ribbonMat.dispose();
    this.group.clear();
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1, withLight = true) {
    for (let i = 0; i < 2; i++) {
      const flash = this.flashes[this.flashIndex];
      this.flashIndex = (this.flashIndex + 1) % this.budget.flashes;
      const m = flash.sprite;
      m.visible = true;
      m.position.copy(pos).addScaledVector(dir, 0.06 * scale);
      // One plane facing along the barrel, one across it.
      if (i === 0) m.quaternion.setFromUnitVectors(Z, dir);
      else m.quaternion.setFromUnitVectors(Y, dir);
      m.rotateZ(Math.random() * Math.PI);
      const s = (0.28 + Math.random() * 0.12) * scale;
      m.scale.set(s, i === 0 ? s : s * 2.2, s);
      flash.life = 0.05;
    }
    if (withLight && this.budget.lights) {
      this.light.position.copy(pos).addScaledVector(dir, 0.3);
      this.light.intensity = 26;
      this.lightLife = 0.05;
    }
    this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x, vy: dir.y, vz: dir.z, max: 0.06, s0: 0.25 * scale, s1: 0.4 * scale, r: 1, g: 0.75, b: 0.4, a0: 0.9, grav: 0, drag: 0 });
    for (let i = 0; i < Math.ceil(2 * this.budget.density); i++) {
      this.smoke.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * 1.2 + (Math.random() - 0.5) * 0.3, vy: dir.y * 1.2 + 0.25, vz: dir.z * 1.2 + (Math.random() - 0.5) * 0.3,
        max: 0.5 + Math.random() * 0.4, s0: 0.08, s1: 0.45, r: 0.8, g: 0.8, b: 0.8, a0: 0.18, grav: -0.3, drag: 2.5,
      });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, source: "local" | "friendly" | "enemy" = "local") {
    const d = _v.subVectors(to, from);
    const length = d.length();
    if (!Number.isFinite(length) || length < 0.15) return;
    let tr: Tracer;
    if (this.tracers.length < this.budget.tracers) {
      tr = this.tracerPool.pop()!;
      this.tracers.push(tr);
    } else {
      this.tracerIndex %= this.tracers.length;
      tr = this.tracers[this.tracerIndex++];
    }
    tr.mesh.visible = tr.trail.visible = true;
    tr.from.copy(from);
    tr.dir.copy(d).normalize();
    tr.length = length;
    tr.t = 0;
    const color = TRACER_COLORS[source];
    (tr.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    (tr.trail.material as THREE.MeshBasicMaterial).color.copy(color);
    // Initialize immediately: a recycled streak must never flash at its old position.
    this.placeTracer(tr);
  }

  private placeTracer(tr: Tracer) {
    const head = Math.min(tr.length, Math.max(0.15, tr.t * 380));
    const tail = Math.max(0, head - 7);
    const fade = Math.max(0, 1 - Math.max(0, tr.t - tr.length / 380) / 0.12);
    tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, head);
    tr.mesh.quaternion.setFromUnitVectors(NEG_Z, _v.copy(tr.dir).negate());
    tr.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    (tr.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
    tr.trail.position.copy(tr.mesh.position);
    tr.trail.quaternion.copy(tr.mesh.quaternion);
    tr.trail.scale.set(1.8, 1.8, head);
    (tr.trail.material as THREE.MeshBasicMaterial).opacity = 0.15 * fade;
  }

  /**
   * A dashing player's wake: pale streaks left hanging along the way they went, for this frame's
   * travel, and a few soft puffs of disturbed air. How much is left follows the time passed, not
   * the frames drawn, so several players dashing at once cost the same at any frame rate.
   * `puffs` is off for your own wake: the third-person camera flies straight through it, and a
   * puff right on the lens covers the whole screen.
   */
  dashTrail(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, puffs = true) {
    const streaks = Math.floor(WAKE_STREAKS * dt * Math.max(0.5, this.budget.density) + Math.random());
    for (let i = 0; i < streaks; i++) {
      const back = Math.random() * dt;
      this.glow.spawn({
        x: pos.x - vel.x * back + (Math.random() - 0.5) * 0.5, y: pos.y + 0.3 + Math.random() * 1.3, z: pos.z - vel.z * back + (Math.random() - 0.5) * 0.5,
        vx: vel.x * 0.05, vy: 0.2, vz: vel.z * 0.05,
        max: 0.26 + Math.random() * 0.22, s0: 0.17, s1: 0.02, r: 0.55, g: 0.9, b: 1, a0: 0.75, grav: 0, drag: 2,
      });
    }
    if (puffs && Math.random() < WAKE_PUFFS * dt) {
      this.smoke.spawn({ x: pos.x, y: pos.y + 0.9, z: pos.z, vx: 0, vy: 0.3, vz: 0, max: 0.45, s0: 0.6, s1: 1.3, r: 0.8, g: 0.92, b: 0.97, a0: 0.16, grav: 0, drag: 2 });
    }
  }

  /**
   * Lays the ribbon of `id`'s dash up to `pos` (feet). Call every frame of the dash and once more
   * as it ends; the first frame without a call ends the ribbon, which then hangs and dissolves.
   * A new ribbon starts at `from`, where the dash began. `strength` thins your own, which would
   * otherwise hide what you dashed away from.
   */
  dashRibbon(id: string, pos: THREE.Vector3, from: THREE.Vector3 = pos, strength = 1) {
    let r: Ribbon | undefined;
    for (const x of this.ribbons) if (x.live && x.id === id) { r = x; break; }
    if (!r) {
      // A free ribbon, else the one closest to gone. None is taken from a dash still under way.
      for (const x of this.ribbons) {
        if (x.n === 0) { r = x; break; }
        if (!x.live && (!r || x.age > r.age)) r = x;
      }
      if (!r) return;
      // Shown by the next update, once shaped: a reused ribbon must never flash where it last hung.
      r.mesh.visible = false;
      r.id = id; r.live = true; r.age = 0; r.strength = strength; r.n = 2;
      r.points[0] = from.x; r.points[1] = from.y + RIBBON_LIFT; r.points[2] = from.z;
    }
    r.fed = true;
    const p = r.points, head = (r.n - 1) * 3;
    p[head] = pos.x; p[head + 1] = pos.y + RIBBON_LIFT; p[head + 2] = pos.z;
    // Far enough from the last point dropped: leave this one behind and carry on with a new head.
    if (r.n < RIBBON_POINTS && Math.hypot(p[head] - p[head - 3], p[head + 1] - p[head - 2], p[head + 2] - p[head - 1]) > RIBBON_SPACING) {
      p[head + 3] = p[head]; p[head + 4] = p[head + 1]; p[head + 5] = p[head + 2];
      r.n++;
    }
  }

  /** Ends ribbons no longer being laid, ages them out, and turns the rest to face `eye`. */
  private updateRibbons(dt: number, eye: THREE.Vector3) {
    this.ribbonTime += dt;
    for (const r of this.ribbons) {
      if (r.n === 0) continue;
      if (r.fed) r.fed = false;
      else r.live = false;
      if (!r.live && (r.age += dt) >= RIBBON_LINGER) {
        r.n = 0;
        r.mesh.visible = false;
        continue;
      }
      this.shapeRibbon(r, eye);
    }
  }

  private shapeRibbon(r: Ribbon, eye: THREE.Vector3) {
    const p = r.points, n = r.n, geo = r.mesh.geometry;
    const position = geo.getAttribute("position") as THREE.BufferAttribute;
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    const color = geo.getAttribute("color") as THREE.BufferAttribute;
    let total = 0;
    _ribbonLength[0] = 0;
    for (let i = 1; i < n; i++) {
      const c = i * 3;
      total += Math.hypot(p[c] - p[c - 3], p[c + 1] - p[c - 2], p[c + 2] - p[c - 1]);
      _ribbonLength[i] = total;
    }
    const gone = r.age / RIBBON_LINGER;
    const scroll = (this.ribbonTime * RIBBON_DRIFT) % 1;
    let tx = 0, ty = 0, tz = 0;
    for (let i = 0; i < n; i++) {
      const c = i * 3, a = Math.max(0, i - 1) * 3, b = Math.min(n - 1, i + 1) * 3;
      // The way the ribbon runs here; a point on top of its neighbours keeps the last one found.
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], dl = Math.hypot(dx, dy, dz);
      if (dl > 1e-4) { tx = dx / dl; ty = dy / dl; tz = dz / dl; }
      const ex = eye.x - p[c], ey = eye.y - p[c + 1], ez = eye.z - p[c + 2], far = Math.hypot(ex, ey, ez);
      // Across the ribbon, square to the line of sight; lying flat when looked at dead along it.
      let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex, sl = Math.hypot(sx, sy, sz);
      if (sl < 1e-5) { sx = -tz; sy = 0; sz = tx; sl = Math.hypot(sx, sz) || 1; }
      const along = total > 0 ? _ribbonLength[i] / total : 1;
      const half = RIBBON_WIDTH * 0.5 * (0.6 + 0.4 * along) * (1 + 0.3 * gone) / sl;
      // Soft at both ends, fainter toward the start, eaten away from the start as it ages, and
      // thinned right at the lens so flying through one never whites out the screen.
      const alpha = i === 0 || i === n - 1 ? 0 : r.strength * (0.7 + 0.3 * along)
        * Math.min(1, Math.max(0, (along + 0.35 - gone * 1.35) / 0.35)) * Math.min(1, Math.max(0, (far - 0.8) / 2));
      const u = _ribbonLength[i] / RIBBON_TILE - scroll;
      position.setXYZ(i * 2, p[c] + sx * half, p[c + 1] + sy * half, p[c + 2] + sz * half);
      position.setXYZ(i * 2 + 1, p[c] - sx * half, p[c + 1] - sy * half, p[c + 2] - sz * half);
      uv.setXY(i * 2, u, 0);
      uv.setXY(i * 2 + 1, u, 1);
      color.setXYZW(i * 2, RIBBON_GLOW, RIBBON_GLOW, RIBBON_GLOW, alpha);
      color.setXYZW(i * 2 + 1, RIBBON_GLOW, RIBBON_GLOW, RIBBON_GLOW, alpha);
    }
    position.needsUpdate = uv.needsUpdate = color.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    r.mesh.visible = true;
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, soft: boolean) {
    const n = normal;
    const col = soft ? [0.42, 0.36, 0.26] : [0.62, 0.6, 0.56];
    for (let i = 0; i < Math.ceil(5 * this.budget.density); i++) {
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: n.x * (1 + Math.random() * 1.5) + (Math.random() - 0.5), vy: n.y * (1 + Math.random() * 1.5) + Math.random() * 0.6, vz: n.z * (1 + Math.random() * 1.5) + (Math.random() - 0.5),
        max: 0.5 + Math.random() * 0.5, s0: 0.05, s1: 0.35 + Math.random() * 0.2, r: col[0], g: col[1], b: col[2], a0: 0.55, grav: 0.4, drag: 3,
      });
    }
    if (!soft) {
      for (let i = 0; i < Math.ceil(4 * this.budget.density); i++) {
        this.glow.spawn({
          x: point.x, y: point.y, z: point.z,
          vx: n.x * 3 + (Math.random() - 0.5) * 4, vy: n.y * 3 + Math.random() * 3, vz: n.z * 3 + (Math.random() - 0.5) * 4,
          max: 0.15 + Math.random() * 0.15, s0: 0.03, s1: 0.01, r: 1, g: 0.7, b: 0.35, a0: 1, grav: 9, drag: 1,
        });
      }
    }
    this.addDecal(point, n);
  }

  blood(point: THREE.Vector3, dir: THREE.Vector3, head: boolean) {
    // Distinct droplets travel through the victim, with a wide outward spray.
    // Keep enough droplets on Low to communicate a hit without expensive mist.
    const count = Math.max(head ? 12 : 8, Math.round((head ? 24 : 18) * this.budget.density));
    for (let i = 0; i < count; i++) {
      const speed = 2.2 + Math.random() * 3.3;
      const spread = head ? 2.2 : 1.7;
      this.droplets.spawn({
        x: point.x + (Math.random() - 0.5) * 0.035, y: point.y, z: point.z + (Math.random() - 0.5) * 0.035,
        vx: dir.x * speed + (Math.random() - 0.5) * spread,
        vy: dir.y * speed + 0.3 + Math.random() * 1.7,
        vz: dir.z * speed + (Math.random() - 0.5) * spread,
        max: 0.32 + Math.random() * 0.3, s0: 0.012 + Math.random() * 0.023, s1: 0.008 + Math.random() * 0.004,
        r: 0.5 + Math.random() * 0.14, g: 0.004, b: 0.012, a0: 0.98, grav: 8, drag: 1.5,
      });
    }
    for (let i = 0; i < Math.ceil((head ? 4 : 2) * this.budget.density); i++) {
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * 1.1 + (Math.random() - 0.5), vy: dir.y + Math.random() * 0.7, vz: dir.z * 1.1 + (Math.random() - 0.5),
        max: 0.18 + Math.random() * 0.15, s0: 0.12, s1: head ? 0.34 : 0.25, r: 0.57, g: 0.008, b: 0.015, a0: 0.6, grav: 1, drag: 5,
      });
    }
  }

  /** Call only with an actual nearby world hit; never leave a stain floating in air. */
  bloodSplatter(point: THREE.Vector3, normal: THREE.Vector3, head = false) {
    const index = this.bloodDecalIndex;
    this.bloodDecalIndex = (index + 1) % this.budget.bloodDecals;
    this.dummy.position.copy(point).addScaledVector(normal, 0.012);
    this.dummy.quaternion.setFromUnitVectors(Z, normal);
    this.dummy.rotateZ(Math.random() * Math.PI * 2);
    const size = (head ? 0.68 : 0.45) + Math.random() * 0.22;
    this.dummy.scale.set(size, size * (0.8 + Math.random() * 0.5), 1);
    this.dummy.updateMatrix();
    this.bloodDecals.setMatrixAt(index, this.dummy.matrix);
    this.bloodDecals.instanceMatrix.needsUpdate = true;
    this.bloodDecalLives[index] = this.bloodDecalMaxLives[index] = 4.5 + Math.random() * 1.5;
    this.bloodDecalOpacities[index] = 1;
    this.bloodDecalAlpha.needsUpdate = true;
    this.bloodDecals.visible = true;
  }

  explosion(p: THREE.Vector3) {
    // Fireball.
    for (let i = 0; i < Math.ceil(40 * this.budget.density); i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.glow.spawn({
        x: p.x, y: p.y + 0.4, z: p.z,
        vx: Math.cos(a) * u * 9, vy: 1.5 + Math.random() * 7, vz: Math.sin(a) * u * 9,
        max: 0.35 + Math.random() * 0.4, s0: 1.8 + Math.random() * 1.4, s1: 4.2, r: 1, g: 0.5 + Math.random() * 0.25, b: 0.18, a0: 0.95, grav: -1, drag: 4,
      });
    }
    // Smoke column.
    for (let i = 0; i < Math.ceil(44 * this.budget.density); i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.smoke.spawn({
        x: p.x, y: p.y + 0.5, z: p.z,
        vx: Math.cos(a) * u * 7, vy: 2 + Math.random() * 5.5, vz: Math.sin(a) * u * 7,
        max: 3.2 + Math.random() * 2.5, s0: 1.4, s1: 6.5 + Math.random() * 3, r: 0.26, g: 0.24, b: 0.22, a0: 0.6, grav: -0.5, drag: 1.6,
      });
    }
    // Dust ring kicked out along the ground.
    for (let i = 0; i < Math.ceil(20 * this.budget.density); i++) {
      const a = (i / 20) * Math.PI * 2 + Math.random() * 0.3;
      this.smoke.spawn({
        x: p.x, y: p.y + 0.2, z: p.z,
        vx: Math.cos(a) * 11, vy: 0.4 + Math.random(), vz: Math.sin(a) * 11,
        max: 1.4 + Math.random(), s0: 0.8, s1: 3.5, r: 0.42, g: 0.39, b: 0.34, a0: 0.45, grav: 0, drag: 3,
      });
    }
    // Sparks and fragments.
    for (let i = 0; i < Math.ceil(36 * this.budget.density); i++) {
      this.glow.spawn({
        x: p.x, y: p.y + 0.2, z: p.z,
        vx: (Math.random() - 0.5) * 26, vy: Math.random() * 15, vz: (Math.random() - 0.5) * 26,
        max: 0.6 + Math.random() * 0.7, s0: 0.1, s1: 0.03, r: 1, g: 0.7, b: 0.3, a0: 1, grav: 14, drag: 0.8,
      });
    }
    this.boomLight.position.set(p.x, p.y + 1.2, p.z);
    this.boomLight.intensity = this.budget.lights ? 220 : 0;
    this.boomLife = 0.35;
  }

  private addDecal(point: THREE.Vector3, normal: THREE.Vector3) {
    this.dummy.position.copy(point).addScaledVector(normal, 0.01);
    this.dummy.quaternion.setFromUnitVectors(Z, normal);
    this.dummy.rotateZ(Math.random() * Math.PI * 2);
    const s = 0.7 + Math.random() * 0.6;
    this.dummy.scale.set(s, s, s);
    this.dummy.updateMatrix();
    this.decals.setMatrixAt(this.decalIndex, this.dummy.matrix);
    this.decalIndex = (this.decalIndex + 1) % this.budget.decals;
    this.decalCount = Math.min(this.decalCount + 1, this.budget.decals);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** A spent case thrown from a gun's ejection port (see Casings.eject). */
  casing(port: THREE.Vector3, gun: THREE.Quaternion, carry: THREE.Vector3, kind: CasingKind, floor: number) {
    this.casings.eject(port, gun, carry, kind, floor);
  }

  /** `eye` is where the view is from: dash ribbons turn to face it. */
  update(dt: number, eye: THREE.Vector3 = _origin) {
    this.updateRibbons(dt, eye);
    this.smoke.update(dt);
    this.casings.update(dt);
    this.glow.update(dt);
    this.droplets.update(dt);
    for (let i = 0; i < this.budget.flashes; i++) {
      const f = this.flashes[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) f.sprite.visible = false;
    }
    this.lightLife -= dt;
    if (this.lightLife <= 0) this.light.intensity = 0;
    this.boomLife -= dt;
    this.boomLight.intensity = this.budget.lights && this.boomLife > 0 ? 220 * (this.boomLife / 0.35) : 0;

    let stains = false, alphaChanged = false;
    for (let i = 0; i < this.budget.bloodDecals; i++) {
      if (this.bloodDecalLives[i] <= 0) continue;
      this.bloodDecalLives[i] = Math.max(0, this.bloodDecalLives[i] - dt);
      // Fade only near the end so the first hit stays crisp and visible.
      this.bloodDecalOpacities[i] = Math.min(1, this.bloodDecalLives[i] / Math.min(1.5, this.bloodDecalMaxLives[i]));
      stains ||= this.bloodDecalLives[i] > 0;
      alphaChanged = true;
    }
    this.bloodDecals.visible = stains;
    if (alphaChanged) this.bloodDecalAlpha.needsUpdate = true;

    // Travel at bullet speed, then retain a brief fading path even at close range.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      if (tr.t >= tr.length / 380 + 0.12) {
        tr.mesh.visible = tr.trail.visible = false;
        this.tracerPool.push(tr);
        // Order does not affect tracer rendering; avoid shifting the active pool.
        this.tracers[i] = this.tracers[this.tracers.length - 1];
        this.tracers.pop();
        continue;
      }
      this.placeTracer(tr);
    }
  }
}
