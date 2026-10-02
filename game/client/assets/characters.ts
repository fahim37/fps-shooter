import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
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
  return { root, bones, meshes, template };
}
