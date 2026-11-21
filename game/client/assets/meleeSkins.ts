import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Painted in sword space so either face has the same temper line and diamond lacing.
function swordTexture(wrap: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = wrap ? 128 : 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const u = x / canvas.width, v = 1 - y / canvas.height;
      const offset = (y * canvas.width + x) * 4;
      if (wrap) {
        const diagonal = u + (u < 0.5 ? v : -v) * 0.65;
        const crossing = Math.abs(2 * u - 1) + 1.65 * Math.abs(2 * v - 1);
        const ridge = Math.abs(Math.sin(Math.PI * 2 * diagonal));
        const thread = Math.sin(2 * Math.PI * diagonal * 21);
        const light = 0.2 + 0.64 * ridge + 0.12 * thread;
        pixels.data.set(crossing < 0.56 ? [35 + 11 * ridge, 40 + 9 * ridge, 49, 255] :
          [27 + light * 39, 46 + light * 53, 86 + light * 77, 255], offset);
      } else {
        const wave = 0.28 + 0.065 * Math.sin(26 * u) + 0.035 * Math.sin(56 * u + 1.1);
        const line = Math.exp(-Math.abs(v - wave) * 48);
        const jade = Math.exp(-Math.abs(v - wave) * 5);
        const bevel = v < wave ? 45 : 0;
        pixels.data.set([22 + bevel + 110 * line, 48 + bevel + 145 * jade,
          53 + bevel + 63 * jade, 255], offset);
      }
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (wrap) texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

const textures: Partial<Record<"wrap" | "steel", THREE.Texture>> = {};

export function finishBlade(root: THREE.Object3D, sword: boolean, near: boolean) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    if (!mesh.isMesh) return;
    const mat = mesh.material;
    const part = mat.name.split("_").pop();
    if (sword && (part === "wrap" || part === "steel")) {
      const wrap = part === "wrap";
      const pos = mesh.geometry.getAttribute("position");
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i), y = pos.getY(i);
        const length = THREE.MathUtils.clamp((-z - 0.065) / 0.75, 0, 1);
        uv[2 * i] = wrap ? z / 0.035 : length;
        uv[2 * i + 1] = wrap ? 0.5 + (y - 0.055 * z) / 0.046 : 0.5 + (y - 0.03 * length ** 2.6) / 0.038;
      }
      mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      mat.map = textures[part] ??= swordTexture(wrap);
      mat.color.set(0xffffff);
      mat.metalness = wrap ? 0.08 : 0.55;
      mat.roughness = wrap ? 0.78 : 0.26;
      if (!wrap) {
        mat.emissiveMap = mat.map;
        mat.emissive.set(0x8effb1);
        mat.emissiveIntensity = 0.85;
      }
    } else {
      const handle = part === "handle";
      mat.color.set(sword ? 0xd5a64f : handle ? 0x303239 : part === "blade" ? 0xf0eeeb : 0xbac1c4);
      mat.metalness = handle ? 0.56 : 0.72;
      mat.roughness = handle ? 0.49 : 0.27;
      if (!sword && !handle && near) polishSteel(mat);
    }
  });
}

// A broad reflection and a narrow polished highlight travel along the grind as the
// wrist rolls. Deriving both from the view normal keeps a stationary blade still.
function polishSteel(mat: THREE.MeshStandardMaterial) {
  mat.roughness = 0.16;
  mat.envMapIntensity = 1.4;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vBladeLength;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBladeLength = (-position.z - 0.085) / 0.195;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBladeLength;")
      .replace("#include <opaque_fragment>", `
        vec3 reflected = reflect(-normalize(vViewPosition), normal);
        float band = abs(vBladeLength - (0.5 + dot(reflected, vec3(0.55, 0.36, 0.38))));
        float shine = 0.12 + 0.3 * exp(-9.0 * band * band) + 0.85 * exp(-180.0 * band * band);
        outgoingLight += vec3(0.84, 0.94, 1.0) * shine * smoothstep(-0.03, 0.08, vBladeLength);
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "balisong-polished";
}

/** An open lacquered scabbard. Its origin is the mouth, shared with the right-hand animation. */
export function swordFittings(root: THREE.Object3D, guard: number, near: boolean) {
  const length = 0.762;
  const rings = [
    // Radius, distance from the mouth, finish.
    [0.024, 0, 0x332621], [0.033, 0, 0xe7be65], [0.033, 0.012, 0xba873d],
    [0.030, 0.014, 0x203453], [0.029, 0.022, 0x172335],
    [0.029, 0.126, 0x263651], [0.030, 0.128, 0xd1a64f], [0.030, 0.134, 0xb38b4a],
    [0.028, 0.136, 0x182435], [0.024, length - 0.021, 0x182435],
    [0.025, length - 0.019, 0xce9f56], [0.021, length, 0xb1803d],
    [0, length + 0.005, 0x8c662e], [0, length - 0.008, 0x10151b],
    [0.019, length - 0.012, 0x10151b], [0.024, 0, 0x141921],
  ];
  const geo = new THREE.LatheGeometry(rings.map(([r, d]) => new THREE.Vector2(r, d)), near ? 24 : 10);
  geo.rotateX(-Math.PI / 2).scale(0.58, 1, 1);
  const pos = geo.getAttribute("position"), colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    pos.setXY(i, pos.getX(i) - 0.003, pos.getY(i) + 0.028 * (pos.getZ(i) / length) ** 2);
    color.setHex(rings[i % rings.length][2]).toArray(colors, i * 3);
  }
  geo.computeVertexNormals();
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sheath = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.48, roughness: 0.27 }));
  sheath.name = "scabbard";
  sheath.position.z = guard;
  root.add(sheath);

  // Four chased brass petals around the existing tsuba, sharing a single draw call.
  if (near) {
    const petals: THREE.BufferGeometry[] = Array.from({ length: 4 }, (_, i) => new THREE.TorusGeometry(0.022, 0.0036, 6, 24)
      .scale(0.62, 1, 1).translate(0, 0.032, 0).rotateZ(i * Math.PI / 2 + Math.PI / 4).translate(0, 0, guard));
    // The ferrule and pommel catch the light at opposite ends of the blue lacing.
    for (const [radius, depth, y, z] of [[0.031, 0.013, 0.001, -0.052], [0.026, 0.012, 0.013, 0.23]]) {
      petals.push(new THREE.CylinderGeometry(radius, radius, depth, 16)
        .rotateX(Math.PI / 2).scale(0.85, 1, 1).translate(-0.002, y, z));
    }
    const guardMesh = new THREE.Mesh(mergeGeometries(petals), new THREE.MeshStandardMaterial({
      color: 0xe7b353, roughness: 0.26, metalness: 0.72,
    }));
    root.add(guardMesh);
    // Curled gold brows frame the mouth on both faces of the lacquer.
    const brows: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) for (const edge of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.01, edge * 0.025, -0.059),
        new THREE.Vector3(side * 0.016, edge * 0.020, -0.035),
        new THREE.Vector3(side * 0.023, edge * 0.011, -0.022),
        new THREE.Vector3(side * 0.019, edge * 0.020, -0.009),
      ]);
      brows.push(new THREE.TubeGeometry(curve, 9, 0.0032, 6, false));
    }
    sheath.add(new THREE.Mesh(mergeGeometries(brows), guardMesh.material));
  }
}
