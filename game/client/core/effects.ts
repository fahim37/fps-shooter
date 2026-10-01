import * as THREE from "three";
import type { Quality } from "../settings";

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
  lights: boolean;
}

const EFFECT_BUDGETS: Record<Quality, EffectBudget> = {
  low: { smoke: 140, glow: 90, blood: 64, density: 0.35, tracers: 16, flashes: 8, decals: 40, bloodDecals: 12, lights: false },
  medium: { smoke: 320, glow: 180, blood: 120, density: 0.65, tracers: 32, flashes: 16, decals: 80, bloodDecals: 24, lights: false },
  high: { smoke: 700, glow: 400, blood: 200, density: 1, tracers: 48, flashes: 24, decals: 140, bloodDecals: 40, lights: true },
  ultra: { smoke: 900, glow: 500, blood: 260, density: 1.15, tracers: 64, flashes: 32, decals: 180, bloodDecals: 48, lights: true },
};

// ---------------------------------------------------------------- effects manager

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  t: number;
}

interface Flash {
  sprite: THREE.Mesh;
  life: number;
}

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
  private boomLight = new THREE.PointLight("#ff9a4a", 0, 22, 2);
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

  constructor() {
    const dot = canvasTexture(64, softDot);
    const puff = canvasTexture(128, smokePuff);
    this.smoke = new ParticleSystem(900, puff, false);
    this.glow = new ParticleSystem(500, dot, true);
    this.droplets = new ParticleSystem(260, canvasTexture(64, bloodDrop), false);
    this.smoke.setLimit(this.budget.smoke);
    this.glow.setLimit(this.budget.glow);
    this.droplets.setLimit(this.budget.blood);
    this.group.add(this.smoke.points, this.glow.points, this.droplets.points, this.light, this.boomLight);
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
      const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.tracerPool.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, t: 0 });
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
    while (this.tracers.length > this.budget.tracers) {
      const tr = this.tracers.pop()!;
      tr.mesh.visible = false;
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
    this.smoke.dispose(); this.glow.dispose(); this.droplets.dispose();
    this.tracerGeo.dispose(); this.tracerMat.dispose();
    this.flashGeo.dispose(); this.flashMat.map?.dispose(); this.flashMat.dispose();
    this.decals.geometry.dispose();
    const mat = this.decals.material as THREE.MeshStandardMaterial;
    mat.map?.dispose(); mat.dispose(); this.decals.dispose();
    this.bloodDecals.geometry.dispose();
    const bloodMat = this.bloodDecals.material as THREE.MeshBasicMaterial;
    bloodMat.map?.dispose(); bloodMat.dispose(); this.bloodDecals.dispose();
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

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const d = _v.subVectors(to, from);
    const length = d.length();
    if (length < 1.5) return;
    let tr: Tracer;
    if (this.tracers.length < this.budget.tracers) {
      tr = this.tracerPool.pop()!;
      this.tracers.push(tr);
    } else {
      this.tracerIndex %= this.tracers.length;
      tr = this.tracers[this.tracerIndex++];
    }
    tr.mesh.visible = true;
    tr.from.copy(from);
    tr.dir.copy(d).normalize();
    tr.length = length;
    tr.t = 0;
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
    for (let i = 0; i < Math.ceil(26 * this.budget.density); i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.glow.spawn({
        x: p.x, y: p.y + 0.3, z: p.z,
        vx: Math.cos(a) * u * 6, vy: 1 + Math.random() * 5, vz: Math.sin(a) * u * 6,
        max: 0.3 + Math.random() * 0.35, s0: 1.2 + Math.random(), s1: 2.8, r: 1, g: 0.55 + Math.random() * 0.2, b: 0.2, a0: 0.9, grav: -1, drag: 4,
      });
    }
    for (let i = 0; i < Math.ceil(30 * this.budget.density); i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.smoke.spawn({
        x: p.x, y: p.y + 0.4, z: p.z,
        vx: Math.cos(a) * u * 5, vy: 1.5 + Math.random() * 4, vz: Math.sin(a) * u * 5,
        max: 2.5 + Math.random() * 2, s0: 1, s1: 4.5 + Math.random() * 2, r: 0.28, g: 0.26, b: 0.24, a0: 0.55, grav: -0.5, drag: 1.8,
      });
    }
    for (let i = 0; i < Math.ceil(24 * this.budget.density); i++) {
      this.glow.spawn({
        x: p.x, y: p.y + 0.2, z: p.z,
        vx: (Math.random() - 0.5) * 18, vy: Math.random() * 12, vz: (Math.random() - 0.5) * 18,
        max: 0.6 + Math.random() * 0.6, s0: 0.08, s1: 0.03, r: 1, g: 0.7, b: 0.3, a0: 1, grav: 14, drag: 0.8,
      });
    }
    this.boomLight.position.set(p.x, p.y + 1, p.z);
    this.boomLight.intensity = this.budget.lights ? 120 : 0;
    this.boomLife = 0.25;
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

  update(dt: number) {
    this.smoke.update(dt);
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
    this.boomLight.intensity = this.budget.lights && this.boomLife > 0 ? 120 * (this.boomLife / 0.25) : 0;

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

    // Tracers: a 4 m streak travelling at bullet speed along the path.
    const SPEED = 380, STREAK = 4;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      const head = Math.min(tr.length, tr.t * SPEED);
      const tail = Math.max(0, tr.t * SPEED - STREAK);
      if (tail >= tr.length - 0.01) {
        tr.mesh.visible = false;
        this.tracerPool.push(tr);
        // Order does not affect tracer rendering; avoid shifting the active pool.
        this.tracers[i] = this.tracers[this.tracers.length - 1];
        this.tracers.pop();
        continue;
      }
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, head);
      // Geometry spans local z ∈ [-1, 0]; point local -Z back along the path so the streak trails the head.
      tr.mesh.quaternion.setFromUnitVectors(NEG_Z, _v.copy(tr.dir).negate());
      tr.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    }
  }
}
