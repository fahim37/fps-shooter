import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { loadGLTF } from "./loaders";
import { TEAM_COLORS } from "../../shared/constants";
import type { ShowoffId } from "../../shared/showcase";

/** Bones driven by the upper-body (aim/reload/shoot) layer; the rest follow locomotion. */
const LOWER_BONES = new Set(["root", "pelvis", "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r"]);

export type ClipName =
  | ShowoffId
  | "idle" | "walk" | "jog" | "sprint" | "crouchIdle" | "crouchWalk" | "jumpStart" | "jumpLoop" | "jumpLand"
  | "death" | "hitChest" | "hitHead" | "pistolIdle" | "aimNeutral" | "aimUp" | "aimDown" | "reload" | "shoot"
  | "roll" | "dance" | "throw" | "knockback" | "slideStart" | "slideLoop" | "slideExit" | "idleFoldArms";

export interface CharacterTemplate {
  scene: THREE.Group;
  /** Full-body clips, retargeted to this body's proportions. */
  full: Map<ClipName, THREE.AnimationClip>;
  /** Clips restricted to lower-body / upper-body bones for layering. */
  lower: Map<ClipName, THREE.AnimationClip>;
  upper: Map<ClipName, THREE.AnimationClip>;
}

let templates: Promise<[CharacterTemplate, CharacterTemplate]> | null = null;

const lobbyTemplates = new Map<number, Promise<CharacterTemplate>>();

/** Lobby requests only the visible body and four showoff clips, never combat/world assets. */
export function loadLobbyCharacter(index: number) {
  const body = index === 1 ? 1 : 0;
  let promise = lobbyTemplates.get(body);
  if (!promise) {
    promise = Promise.all([
      loadGLTF(`/models/char_${body ? "female" : "male"}.glb`),
      loadGLTF("/models/lobby-anims.glb"),
    ]).then(([character, animations]) => makeTemplate(character.scene, animations.animations, findBone(animations.scene, "pelvis")!.position.clone()));
    lobbyTemplates.set(body, promise);
    void promise.catch(() => lobbyTemplates.delete(body));
  }
  return promise;
}

export function loadCharacters() {
  return (templates ??= Promise.all([
    loadGLTF("/models/char_male.glb"),
    loadGLTF("/models/char_female.glb"),
    loadGLTF("/models/anims.glb"),
  ]).then(([male, female, anims]) => {
    const animPelvis = findBone(anims.scene, "pelvis")!.position.clone();
    return [makeTemplate(male.scene, anims.animations, animPelvis), makeTemplate(female.scene, anims.animations, animPelvis)];
  }));
}

function findBone(root: THREE.Object3D, name: string) {
  let found: THREE.Object3D | undefined;
  root.traverse((o) => { if (!found && o.name === name) found = o; });
  return found;
}

function makeTemplate(scene: THREE.Group, clips: THREE.AnimationClip[], animPelvis: THREE.Vector3): CharacterTemplate {
  const pelvis = findBone(scene, "pelvis")!;
  // The clips were authored on the mannequin; scale pelvis translation to this body's hip height.
  const ratio = pelvis.position.length() / animPelvis.length();
  const full = new Map<ClipName, THREE.AnimationClip>();
  const lower = new Map<ClipName, THREE.AnimationClip>();
  const upper = new Map<ClipName, THREE.AnimationClip>();
  for (const src of clips) {
    const clip = src.clone();
    for (const track of clip.tracks) {
      if (track.name === "pelvis.position") {
        const v = track.values;
        for (let i = 0; i < v.length; i++) v[i] *= ratio;
      }
    }
    const name = clip.name as ClipName;
    full.set(name, clip);
    lower.set(name, filterClip(clip, (bone) => LOWER_BONES.has(bone)));
    upper.set(name, filterClip(clip, (bone) => !LOWER_BONES.has(bone)));
  }
  mergeParts(scene);
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  return { scene, full, lower, upper };
}

function filterClip(clip: THREE.AnimationClip, keep: (bone: string) => boolean) {
  const tracks = clip.tracks.filter((t) => keep(t.name.split(".")[0]));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const teamMaterials = new Map<string, THREE.Material>();

/** Ranger outfit tinted per team; skin, eyes and hair keep their own materials. */
function outfitMaterial(src: THREE.MeshStandardMaterial, team: number) {
  const key = `${src.uuid}:${team}`;
  let m = teamMaterials.get(key);
  if (!m) {
    const c = src.clone();
    if (team > 0) {
      const tint = new THREE.Color(TEAM_COLORS[team]);
      // Blend toward the team color only on the cloth (bright, saturated areas of the texture).
      c.onBeforeCompile = (shader) => {
        shader.uniforms.uTeam = { value: tint };
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uTeam;")
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            {
              float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
              float sat = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
              float cloth = smoothstep(0.02, 0.09, sat) * (1.0 - smoothstep(0.35, 0.6, l));
              diffuseColor.rgb = mix(diffuseColor.rgb, uTeam * (l * 2.2 + 0.03), cloth * 0.72);
            }`,
          );
      };
      c.customProgramCacheKey = () => `team${team}`;
    }
    m = c;
    teamMaterials.set(key, m);
  }
  return m;
}

export interface CharacterInstance {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
  meshes: THREE.SkinnedMesh[];
  template: CharacterTemplate;
}

/** Deep-clones a character (skeleton included) and applies the team outfit. */
export function instantiateCharacter(template: CharacterTemplate, team: number, beard: boolean): CharacterInstance {
  const root = cloneSkinned(template.scene) as THREE.Group;
  const bones = new Map<string, THREE.Bone>();
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      meshes.push(m);
      if (m.name === "Beard") m.visible = beard;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (/Ranger/i.test(mat.name)) m.material = outfitMaterial(mat, team);
    }
  });
  shareSkeleton(template, meshes);
  return { root, bones, meshes, template };
}

/** Matrix taking `mesh`'s vertices into the space of `base`'s skeleton, or null if they differ. */
function skeletonOffset(base: THREE.SkinnedMesh, mesh: THREE.SkinnedMesh) {
  const a = base.skeleton, b = mesh.skeleton;
  if (a === b) return new THREE.Matrix4();
  if (a.bones.length !== b.bones.length || b.bones.some((bone, i) => bone !== a.bones[i])) return null;
  const d = _inv.copy(a.boneInverses[0]).invert().multiply(b.boneInverses[0]).clone();
  const same = b.boneInverses.every((inv, i) => {
    const e = _inv.copy(a.boneInverses[i]).invert().multiply(inv).elements;
    return e.every((v, k) => Math.abs(v - d.elements[k]) < 1e-4);
  });
  return same ? d : null;
}

/**
 * Outfit pieces sharing a material become one skinned mesh: same look, one draw call instead of
 * up to seven per character. First-person arm pieces and the optional beard stay separate so
 * they can still be shown or hidden on their own.
 */
function mergeParts(scene: THREE.Object3D) {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const base = meshes[0];
  if (!base) return;
  scene.updateMatrixWorld(true);
  // Merged meshes go where the first part was; it may itself be merged away below.
  const parent = base.parent!, local = base.matrix.clone(), skeleton = base.skeleton, bindMatrix = base.bindMatrix.clone();
  const groups = new Map<string, { mesh: THREE.SkinnedMesh; offset: THREE.Matrix4 }[]>();
  for (const mesh of meshes) {
    const offset = skeletonOffset(base, mesh);
    if (!offset || Array.isArray(mesh.material) || !mesh.bindMatrix.equals(base.bindMatrix) || !mesh.matrixWorld.equals(base.matrixWorld)) continue;
    // The loader clones a material for parts with vertex colors; those copies still merge.
    const material = mesh.material as THREE.MeshStandardMaterial;
    const key = `${material.name}|${material.map?.uuid}|${/Arms/.test(mesh.name) ? "arms" : mesh.name === "Beard" ? "beard" : ""}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = []);
    g.push({ mesh, offset });
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Parts without vertex colors join as white, which is exactly how they rendered.
    const colored = group.find(({ mesh }) => mesh.geometry.getAttribute("color"))?.mesh;
    const colorSize = colored?.geometry.getAttribute("color").itemSize ?? 0;
    const geometries = group.map(({ mesh, offset }) => bakedGeometry(mesh, offset, colorSize));
    if (geometries.some((g) => !g)) continue;
    const geometry = mergeGeometries(geometries as THREE.BufferGeometry[]);
    if (!geometry) { console.warn(`[characters] could not merge ${group.map(({ mesh }) => mesh.name).join(", ")}`); continue; }
    const merged = new THREE.SkinnedMesh(geometry, (colored ?? group[0].mesh).material);
    merged.name = group.map(({ mesh }) => mesh.name).join("+");
    local.decompose(merged.position, merged.quaternion, merged.scale);
    parent.add(merged);
    merged.bind(skeleton, bindMatrix);
    for (const { mesh } of group) mesh.removeFromParent();
  }
}

/** A part's geometry as plain floats, positions moved into the shared skeleton's bind space. */
function bakedGeometry(mesh: THREE.SkinnedMesh, offset: THREE.Matrix4, colorSize: number) {
  const src = mesh.geometry;
  if (!src.getAttribute("position") || !src.getAttribute("normal") || Object.keys(src.morphAttributes).length) return null;
  // bind⁻¹ · offset · bind: identity bind matrices make this just the offset.
  const move = new THREE.Matrix4().copy(mesh.bindMatrix).invert().multiply(offset).multiply(mesh.bindMatrix);
  const turn = new THREE.Matrix3().getNormalMatrix(move);
  const out = new THREE.BufferGeometry();
  const v = new THREE.Vector3();
  for (const [name, a] of Object.entries(src.attributes) as [string, THREE.BufferAttribute][]) {
    if (name === "skinIndex") {
      const j = new Uint16Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) j[i * a.itemSize + k] = a.getComponent(i, k);
      out.setAttribute(name, new THREE.BufferAttribute(j, a.itemSize));
      continue;
    }
    // Dequantized: every part ends up with the same plain float layout, so they can be joined.
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
      if (name === "position") v.fromArray(f, i * 3).applyMatrix4(move).toArray(f, i * 3);
      else if (name === "normal") v.fromArray(f, i * 3).applyMatrix3(turn).normalize().toArray(f, i * 3);
      else if (name === "tangent") v.fromArray(f, i * 4).applyMatrix3(turn).normalize().toArray(f, i * 4);
    }
    out.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
  }
  if (colorSize && !out.getAttribute("color")) {
    out.setAttribute("color", new THREE.BufferAttribute(new Float32Array(out.getAttribute("position").count * colorSize).fill(1), colorSize));
  }
  const index = src.getIndex();
  out.setIndex(index ? Array.from({ length: index.count }, (_, i) => index.getX(i)) : null);
  return out;
}

/** Per template: for each mesh, the offset that lets it use the first mesh's skeleton (or null). */
const skeletonOffsets = new WeakMap<CharacterTemplate, (THREE.Matrix4 | null)[]>();
const _inv = new THREE.Matrix4();

/**
 * Every part of a character is skinned to the same bones, but each imported (quantized) part
 * folds its own position scale / offset into its inverse bind matrices. That offset is the same
 * for every bone, so it moves into the part's bind matrix and all parts share one skeleton:
 * bone matrices are computed and uploaded once per character instead of once per part.
 */
function shareSkeleton(template: CharacterTemplate, meshes: THREE.SkinnedMesh[]) {
  const base = meshes[0]?.skeleton;
  if (!base) return;
  let offsets = skeletonOffsets.get(template);
  if (!offsets) {
    offsets = meshes.map((m) => m.skeleton === base ? null : skeletonOffset(meshes[0], m));
    skeletonOffsets.set(template, offsets);
  }
  meshes.forEach((m, i) => {
    const d = offsets[i];
    if (!d) return;
    // Skinning is bindMatrixInverse · Σ bone · inverse · bindMatrix; keep bindMatrixInverse as is.
    m.bindMatrix.premultiply(d);
    m.skeleton = base;
  });
}
