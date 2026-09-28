import * as THREE from "three";

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
  private pos: Float32Array;
  private size: Float32Array;
  private color: Float32Array;
  private geom: THREE.BufferGeometry;

  constructor(private max: number, map: THREE.Texture, additive: boolean) {
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute("aColor", new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
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
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({ ...p, life: 0 });
  }

  update(dt: number) {
    const ps = this.particles;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) continue;
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
    this.geom.setDrawRange(0, n);
    for (const a of ["position", "aSize", "aColor"]) (this.geom.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
  }
}

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
  private tracers: Tracer[] = [];
  private tracerPool: THREE.Mesh[] = [];
  private tracerGeo = new THREE.CylinderGeometry(0.012, 0.006, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
  private tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.8), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  private flashes: Flash[] = [];
  private flashMat: THREE.MeshBasicMaterial;
  private flashGeo = new THREE.PlaneGeometry(1, 1);
  private light = new THREE.PointLight("#ffb56b", 0, 9, 2);
  private lightLife = 0;
  private boomLight = new THREE.PointLight("#ff9a4a", 0, 22, 2);
  private boomLife = 0;
  private decals: THREE.InstancedMesh;
  private decalIndex = 0;
  private decalCount = 0;
  private dummy = new THREE.Object3D();

  constructor() {
    const dot = canvasTexture(64, softDot);
    const puff = canvasTexture(128, smokePuff);
    this.smoke = new ParticleSystem(700, puff, false);
    this.glow = new ParticleSystem(400, dot, true);
    this.group.add(this.smoke.points, this.glow.points, this.light, this.boomLight);
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
  }

  setViewportHeight(h: number) {
    this.smoke.setViewportHeight(h);
    this.glow.setViewportHeight(h);
  }

  dispose() {
    this.group.removeFromParent();
    this.smoke.dispose(); this.glow.dispose();
    this.tracerGeo.dispose(); this.tracerMat.dispose();
    this.flashGeo.dispose(); this.flashMat.map?.dispose(); this.flashMat.dispose();
    this.decals.geometry.dispose();
    const mat = this.decals.material as THREE.MeshStandardMaterial;
    mat.map?.dispose(); mat.dispose(); this.decals.dispose();
    this.group.clear();
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1, withLight = true) {
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(this.flashGeo, this.flashMat);
      m.position.copy(pos).addScaledVector(dir, 0.06 * scale);
      // One plane facing along the barrel, one across it.
      if (i === 0) m.quaternion.setFromUnitVectors(Z, dir);
      else m.quaternion.setFromUnitVectors(Y, dir);
      m.rotateZ(Math.random() * Math.PI);
      const s = (0.28 + Math.random() * 0.12) * scale;
      m.scale.set(s, i === 0 ? s : s * 2.2, s);
      this.group.add(m);
      this.flashes.push({ sprite: m, life: 0.05 });
    }
    if (withLight) {
      this.light.position.copy(pos).addScaledVector(dir, 0.3);
      this.light.intensity = 26;
      this.lightLife = 0.05;
    }
    this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x, vy: dir.y, vz: dir.z, max: 0.06, s0: 0.25 * scale, s1: 0.4 * scale, r: 1, g: 0.75, b: 0.4, a0: 0.9, grav: 0, drag: 0 });
    for (let i = 0; i < 2; i++) {
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
    const mesh = this.tracerPool.pop() ?? new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.tracers.push({ mesh, from: from.clone(), dir: d.clone().normalize(), length, t: 0 });
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3, soft: boolean) {
    const n = normal;
    const col = soft ? [0.42, 0.36, 0.26] : [0.62, 0.6, 0.56];
    for (let i = 0; i < 5; i++) {
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: n.x * (1 + Math.random() * 1.5) + (Math.random() - 0.5), vy: n.y * (1 + Math.random() * 1.5) + Math.random() * 0.6, vz: n.z * (1 + Math.random() * 1.5) + (Math.random() - 0.5),
        max: 0.5 + Math.random() * 0.5, s0: 0.05, s1: 0.35 + Math.random() * 0.2, r: col[0], g: col[1], b: col[2], a0: 0.55, grav: 0.4, drag: 3,
      });
    }
    if (!soft) {
      for (let i = 0; i < 4; i++) {
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
    const count = head ? 12 : 7;
    for (let i = 0; i < count; i++) {
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * 2 + (Math.random() - 0.5) * 2, vy: dir.y * 2 + Math.random() * 1.2, vz: dir.z * 2 + (Math.random() - 0.5) * 2,
        max: 0.35 + Math.random() * 0.3, s0: 0.06, s1: head ? 0.4 : 0.3, r: 0.45, g: 0.02, b: 0.02, a0: 0.85, grav: 4, drag: 4,
      });
    }
  }

  explosion(p: THREE.Vector3) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.glow.spawn({
        x: p.x, y: p.y + 0.3, z: p.z,
        vx: Math.cos(a) * u * 6, vy: 1 + Math.random() * 5, vz: Math.sin(a) * u * 6,
        max: 0.3 + Math.random() * 0.35, s0: 1.2 + Math.random(), s1: 2.8, r: 1, g: 0.55 + Math.random() * 0.2, b: 0.2, a0: 0.9, grav: -1, drag: 4,
      });
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.smoke.spawn({
        x: p.x, y: p.y + 0.4, z: p.z,
        vx: Math.cos(a) * u * 5, vy: 1.5 + Math.random() * 4, vz: Math.sin(a) * u * 5,
        max: 2.5 + Math.random() * 2, s0: 1, s1: 4.5 + Math.random() * 2, r: 0.28, g: 0.26, b: 0.24, a0: 0.55, grav: -0.5, drag: 1.8,
      });
    }
    for (let i = 0; i < 24; i++) {
      this.glow.spawn({
        x: p.x, y: p.y + 0.2, z: p.z,
        vx: (Math.random() - 0.5) * 18, vy: Math.random() * 12, vz: (Math.random() - 0.5) * 18,
        max: 0.6 + Math.random() * 0.6, s0: 0.08, s1: 0.03, r: 1, g: 0.7, b: 0.3, a0: 1, grav: 14, drag: 0.8,
      });
    }
    this.boomLight.position.set(p.x, p.y + 1, p.z);
    this.boomLight.intensity = 120;
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
    this.decalIndex = (this.decalIndex + 1) % this.decals.instanceMatrix.count;
    this.decalCount = Math.min(this.decalCount + 1, this.decals.instanceMatrix.count);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    this.smoke.update(dt);
    this.glow.update(dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.sprite);
        this.flashes.splice(i, 1);
      }
    }
    this.lightLife -= dt;
    if (this.lightLife <= 0) this.light.intensity = 0;
    this.boomLife -= dt;
    this.boomLight.intensity = this.boomLife > 0 ? 120 * (this.boomLife / 0.25) : 0;

    // Tracers: a 4 m streak travelling at bullet speed along the path.
    const SPEED = 380, STREAK = 4;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      const head = Math.min(tr.length, tr.t * SPEED);
      const tail = Math.max(0, tr.t * SPEED - STREAK);
      if (tail >= tr.length - 0.01) {
        this.group.remove(tr.mesh);
        this.tracerPool.push(tr.mesh);
        this.tracers.splice(i, 1);
        continue;
      }
      tr.mesh.position.copy(tr.from).addScaledVector(tr.dir, head);
      // Geometry spans local z ∈ [-1, 0]; point local -Z back along the path so the streak trails the head.
      tr.mesh.quaternion.setFromUnitVectors(NEG_Z, _v.copy(tr.dir).negate());
      tr.mesh.scale.set(1, 1, Math.max(0.01, head - tail));
    }
  }
}
