import * as THREE from "three";
import { instantiateCharacter, type CharacterTemplate, type CharacterInstance, type ClipName } from "../assets/characters";
import { cloneWeapon, FOREGRIP, WEAPON_META } from "../assets/weapons";
import type { WeaponId } from "../../shared/weapons";
import { solveTwoBone, setBoneWorldQuaternion, rotateBoneWorld } from "./ik";

export type RigMode = "fpp" | "tpp";

export interface RigState {
  /** Feet position (TPP). */
  x: number; y: number; z: number;
  yaw: number;
  pitch: number;
  /** FPP only: camera position and orientation. */
  eye?: THREE.Vector3;
  view?: THREE.Quaternion;
  speed: number;
  /** World yaw of the movement direction. */
  moveYaw: number;
  crouch: boolean;
  grounded: boolean;
  alive: boolean;
  sprint: number;
  ads: number;
  /** -1 when not reloading, else progress 0..1. */
  reload: number;
  /** 0..1 recoil kick, decays externally. */
  recoil: number;
  /** FPP view-space offsets for bob and sway. */
  bob?: THREE.Vector2;
  sway?: THREE.Vector2;
  /** 0..1 pull-back when facing a wall (FPP). */
  tuck?: number;
  /** 0..1 grenade throw motion. */
  throwing?: number;
}

interface HandRefs {
  right: THREE.Matrix4;
  left: THREE.Matrix4;
  head: THREE.Vector3;
}

const refCache = new WeakMap<CharacterTemplate, HandRefs>();
const LOCO: ClipName[] = ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "jumpLoop"];
const FPP_VISIBLE = /Arms/;
const PROCEDURAL_BONES = ["spine_01", "spine_03", "upperarm_r", "lowerarm_r", "hand_r", "upperarm_l", "lowerarm_l", "hand_l"];

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _bodyLeft = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _handQuat = new THREE.Quaternion();
const _leftLocal = new THREE.Matrix4();

/**
 * Hand offsets relative to a gun held in the pistol aim pose: the pose already has the
 * right hand wrapped around a grip pointing forward, which we reuse for every weapon.
 */
function handRefs(template: CharacterTemplate): HandRefs {
  let r = refCache.get(template);
  if (r) return r;
  const inst = instantiateCharacter(template, 0, false);
  const mixer = new THREE.AnimationMixer(inst.root);
  mixer.clipAction(template.full.get("aimNeutral")!).play();
  mixer.update(0);
  inst.root.updateMatrixWorld(true);
  const b = (n: string) => inst.bones.get(n)!;
  const palm = b("hand_r").getWorldPosition(new THREE.Vector3())
    .lerp(b("middle_01_r").getWorldPosition(new THREE.Vector3()), 0.55);
  palm.y -= 0.015;
  const gun0 = new THREE.Matrix4().compose(palm, new THREE.Quaternion().setFromAxisAngle(UP, Math.PI), _s);
  const inv = gun0.clone().invert();
  r = {
    right: inv.clone().multiply(b("hand_r").matrixWorld),
    left: inv.clone().multiply(b("hand_l").matrixWorld),
    head: b("Head").getWorldPosition(new THREE.Vector3()),
  };
  mixer.stopAllAction();
  refCache.set(template, r);
  return r;
}

export class CharacterRig {
  /** Add this to the scene. Stays at identity: children are placed in world space. */
  readonly object = new THREE.Group();
  /** Carries the character; positioned at the feet (TPP) or behind the camera (FPP). */
  private body = new THREE.Group();
  readonly inst: CharacterInstance;
  private mixer: THREE.AnimationMixer;
  private loco = new Map<ClipName, THREE.AnimationAction>();
  private locoWeights = new Map<ClipName, number>();
  private aim: Record<"n" | "u" | "d", THREE.AnimationAction>;
  private death: THREE.AnimationAction;
  private refs: HandRefs;
  private gunPivot = new THREE.Object3D();
  private guns = new Map<WeaponId, THREE.Object3D>();
  private weapon: WeaponId | null = null;
  private legYaw = 0;
  private dead = false;
  private deadTime = 0;
  private animationPose: { bone: THREE.Bone; quaternion: THREE.Quaternion }[];
  /** World-space muzzle position of the current weapon (for effects). */
  readonly muzzle = new THREE.Vector3();
  readonly muzzleDir = new THREE.Vector3();

  constructor(
    template: CharacterTemplate,
    private weaponTemplates: Map<WeaponId, THREE.Object3D>,
    team: number,
    beard: boolean,
    readonly mode: RigMode,
  ) {
    this.inst = instantiateCharacter(template, team, beard);
    this.animationPose = PROCEDURAL_BONES.map((name) => {
      const bone = this.inst.bones.get(name)!;
      return { bone, quaternion: bone.quaternion.clone() };
    });
    this.refs = handRefs(template);
    this.body.add(this.inst.root);
    this.object.add(this.body);
    this.object.add(this.gunPivot);
    this.mixer = new THREE.AnimationMixer(this.inst.root);

    for (const name of LOCO) {
      const a = this.mixer.clipAction(template.lower.get(name)!);
      a.play();
      a.setEffectiveWeight(name === "idle" ? 1 : 0);
      this.loco.set(name, a);
      this.locoWeights.set(name, name === "idle" ? 1 : 0);
    }
    const up = (n: ClipName) => {
      const a = this.mixer.clipAction(template.upper.get(n)!);
      a.play();
      return a;
    };
    this.aim = { n: up("aimNeutral"), u: up("aimUp"), d: up("aimDown") };
    this.death = this.mixer.clipAction(template.full.get("death")!);
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;

    for (const m of this.inst.meshes) {
      if (mode === "fpp") {
        m.visible = FPP_VISIBLE.test(m.name);
        m.castShadow = false;
      }
    }
  }

  setWeapon(id: WeaponId) {
    if (this.weapon === id) return;
    this.weapon = id;
    for (const g of this.guns.values()) g.visible = false;
    let g = this.guns.get(id);
    if (!g) {
      g = cloneWeapon(this.weaponTemplates, id);
      if (this.mode === "fpp") g.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
      this.gunPivot.add(g);
      this.guns.set(id, g);
    }
    g.visible = true;
  }

  setVisible(v: boolean) {
    this.object.visible = v;
  }

  /** Detaches from the scene. Animation state is kept, so a rig can be re-added. */
  dispose() {
    this.object.removeFromParent();
  }

  update(dt: number, s: RigState) {
    // AnimationMixer only writes a property when its sampled value changes. Restore the
    // animation-only pose first, or our IK / torso edits accumulate on held keyframes.
    for (const pose of this.animationPose) pose.bone.quaternion.copy(pose.quaternion);
    if (!s.alive) {
      if (!this.dead) {
        this.dead = true;
        this.deadTime = 0;
        for (const a of this.loco.values()) a.fadeOut(0.15);
        for (const a of Object.values(this.aim)) a.fadeOut(0.15);
        this.death.reset().setEffectiveWeight(1).fadeIn(0.1).play();
      }
      this.deadTime += dt;
      this.gunPivot.visible = this.deadTime < 0.25;
      this.placeRoot(s, 0);
      this.mixer.update(dt);
      this.captureAnimationPose();
      return;
    }
    if (this.dead) {
      this.dead = false;
      this.death.stop();
      for (const a of this.loco.values()) a.reset().play();
      for (const a of Object.values(this.aim)) a.reset().play();
      this.gunPivot.visible = true;
    }

    if (this.mode === "tpp") this.updateLocomotion(dt, s);
    this.updateAimLayer(s);
    this.mixer.update(dt);
    this.captureAnimationPose();

    this.placeRoot(s, this.mode === "tpp" ? this.legYaw : 0);
    this.object.updateMatrixWorld(true);
    if (this.mode === "tpp" && Math.abs(this.legYaw) > 1e-3) {
      // Legs face the movement direction; turn the torso back onto the aim.
      rotateBoneWorld(this.inst.bones.get("spine_01")!, _q.setFromAxisAngle(UP, -this.legYaw * 0.6), true);
      rotateBoneWorld(this.inst.bones.get("spine_03")!, _q.setFromAxisAngle(UP, -this.legYaw * 0.4), true);
    }
    this.placeGun(s);
    this.solveArms(s);
  }

  private captureAnimationPose() {
    for (const pose of this.animationPose) pose.quaternion.copy(pose.bone.quaternion);
  }

  private placeRoot(s: RigState, legYaw: number) {
    if (this.mode === "fpp" && s.eye && s.view) {
      // Head at the camera, body oriented with the view (only the arms are drawn).
      _q.copy(s.view).multiply(_q2.setFromAxisAngle(UP, Math.PI));
      this.body.quaternion.copy(_q);
      _v.copy(this.refs.head).applyQuaternion(_q);
      // The body sits forward of the camera so the (hidden) shoulders can reach the gun.
      _v2.set(0, -0.04, -0.17).applyQuaternion(s.view);
      this.body.position.copy(s.eye).sub(_v).add(_v2);
    } else {
      this.body.position.set(s.x, s.y, s.z);
      this.body.quaternion.setFromAxisAngle(UP, s.yaw + Math.PI + legYaw);
    }
  }

  private updateLocomotion(dt: number, s: RigState) {
    const moving = s.speed > 0.4 && s.grounded;
    let rel = wrapAngle(s.moveYaw - s.yaw);
    let backwards = false;
    if (Math.abs(rel) > (100 * Math.PI) / 180) {
      backwards = true;
      rel = wrapAngle(rel - Math.PI);
    }
    const targetLeg = moving ? THREE.MathUtils.clamp(rel, -1.1, 1.1) : 0;
    this.legYaw += (targetLeg - this.legYaw) * Math.min(1, dt * 8);

    let pick: ClipName;
    let rate = 1;
    if (!s.grounded) pick = "jumpLoop";
    else if (s.crouch) { pick = moving ? "crouchWalk" : "crouchIdle"; rate = s.speed / 2.2; }
    else if (!moving) pick = "idle";
    else if (s.speed < 3.4) { pick = "walk"; rate = s.speed / 1.7; }
    else if (s.speed < 6.6 || backwards) { pick = "jog"; rate = s.speed / 4.6; }
    else { pick = "sprint"; rate = s.speed / 7; }

    const k = Math.min(1, dt * 9);
    for (const [name, a] of this.loco) {
      const target = name === pick ? 1 : 0;
      const blended = this.locoWeights.get(name)! + (target - this.locoWeights.get(name)!) * k;
      // Three evaluates every track for any positive weight, however tiny. Finish
      // the fade so previously used movement clips don't keep costing CPU forever.
      const w = Math.abs(blended - target) < 0.001 ? target : blended;
      this.locoWeights.set(name, w);
      a.setEffectiveWeight(w);
      if (name === pick && name !== "idle" && name !== "crouchIdle" && name !== "jumpLoop") {
        a.timeScale = THREE.MathUtils.clamp(rate, 0.5, 1.6) * (backwards ? -1 : 1);
      }
    }
  }

  private updateAimLayer(s: RigState) {
    // Pitch blends between the aim-down / neutral / aim-up poses.
    const p = THREE.MathUtils.clamp(s.pitch / 1.1, -1, 1);
    const up = Math.max(0, p), down = Math.max(0, -p);
    this.aim.u.setEffectiveWeight(up);
    this.aim.d.setEffectiveWeight(down);
    this.aim.n.setEffectiveWeight(1 - up - down);
  }

  private placeGun(s: RigState) {
    const w = this.weapon;
    if (!w) return;
    const meta = WEAPON_META[w];
    const pistol = w === "pistol";
    const reload = s.reload >= 0 ? Math.sin(Math.min(1, s.reload) * Math.PI) : 0;
    const sprint = s.sprint * (1 - s.ads);

    if (this.mode === "fpp" && s.eye && s.view) {
      // View-space placement: hip at the lower right, ADS lines the sights up with the eye.
      // Eye just above the top of the receiver / rear sight.
      const sightY = pistol ? meta.max[1] - 0.004 : w === "sniper" ? meta.max[1] - 0.01 : meta.max[1] + 0.004;
      const hip = pistol ? _v.set(0.13, -0.21, -0.34) : _v.set(0.15, -0.25, -0.3);
      // Keep the stock end just in front of the eye.
      const ads = _v2.set(0, -sightY, pistol ? -0.36 : -(meta.max[2] + 0.07));
      hip.lerp(ads, s.ads);
      hip.x += (s.sway?.x ?? 0) + (s.bob?.x ?? 0);
      hip.y += (s.sway?.y ?? 0) + (s.bob?.y ?? 0) - reload * 0.07 - sprint * 0.05 - (s.throwing ?? 0) * 0.25;
      hip.z += s.recoil * 0.045 + (s.tuck ?? 0) * 0.16;
      hip.x += sprint * -0.04;
      _e.set(
        s.recoil * 0.06 - reload * 0.45 - sprint * 0.55 - (s.tuck ?? 0) * 0.7,
        sprint * 0.75 + reload * 0.15,
        reload * 0.5 + sprint * 0.25,
        "YXZ",
      );
      _q.copy(s.view).multiply(_q2.setFromEuler(_e));
      this.gunPivot.position.copy(s.eye).add(hip.applyQuaternion(s.view));
      this.gunPivot.quaternion.copy(_q);
    } else {
      // Stock in the right shoulder, pointing along the aim.
      const shoulder = _v.setFromMatrixPosition(this.inst.bones.get(pistol ? "neck_01" : "upperarm_r")!.matrixWorld);
      _e.set(s.pitch + s.recoil * (pistol ? 0.075 : 0.035) - reload * 0.35 - sprint * 0.6, s.yaw + sprint * 0.6, reload * 0.45, "YXZ");
      _q.setFromEuler(_e);
      const fwd = _v2.set(0, 0, -1).applyQuaternion(_q);
      const reach = pistol ? 0.5 : meta.max[2] + 0.02;
      shoulder.addScaledVector(fwd, reach - s.recoil * 0.015);
      shoulder.y += (pistol ? -0.06 : -0.035) + s.ads * 0.03 - reload * 0.1 - sprint * 0.12;
      if (pistol) shoulder.add(_v2.set(0.02, 0, 0).applyQuaternion(_q));
      this.gunPivot.position.copy(shoulder);
      this.gunPivot.quaternion.copy(_q);
    }
    this.gunPivot.updateMatrixWorld(true);
    this.muzzle.set(...meta.muzzle).applyMatrix4(this.gunPivot.matrixWorld);
    this.muzzleDir.set(0, 0, -1).applyQuaternion(this.gunPivot.quaternion);
  }

  private solveArms(s: RigState) {
    const w = this.weapon;
    if (!w) return;
    const b = (n: string) => this.inst.bones.get(n)!;
    const gun = this.gunPivot.matrixWorld;
    const reload = s.reload >= 0 ? Math.sin(Math.min(1, s.reload) * Math.PI) : 0;
    const bodyLeft = _bodyLeft.set(1, 0, 0).applyQuaternion(this.body.quaternion); // model +X is the character's left

    // Right hand on the grip.
    _m.multiplyMatrices(gun, this.refs.right);
    _target.setFromMatrixPosition(_m);
    _handQuat.setFromRotationMatrix(_m2.extractRotation(_m));
    _pole.setFromMatrixPosition(b("upperarm_r").matrixWorld).addScaledVector(bodyLeft, -0.35).addScaledVector(DOWN, 0.65);
    solveTwoBone(b("upperarm_r"), b("lowerarm_r"), b("hand_r"), _target, _pole, 1, true);
    setBoneWorldQuaternion(b("hand_r"), _handQuat, true);

    // Support hand on the foregrip (moves to the magazine while reloading).
    const fg = FOREGRIP[w];
    const leftLocal = _leftLocal.copy(this.refs.left);
    if (w !== "pistol") {
      const pos = _v.setFromMatrixPosition(leftLocal);
      pos.set(pos.x * 0.3 + fg[0], fg[1] - 0.045 - reload * 0.1, fg[2] + reload * 0.2);
      leftLocal.setPosition(pos);
    } else if (reload > 0) {
      const pos = _v.setFromMatrixPosition(leftLocal);
      pos.y -= reload * 0.12;
      leftLocal.setPosition(pos);
    }
    _m.multiplyMatrices(gun, leftLocal);
    _target.setFromMatrixPosition(_m);
    _handQuat.setFromRotationMatrix(_m2.extractRotation(_m));
    _pole.setFromMatrixPosition(b("upperarm_l").matrixWorld).addScaledVector(bodyLeft, 0.35).addScaledVector(DOWN, 0.65);
    solveTwoBone(b("upperarm_l"), b("lowerarm_l"), b("hand_l"), _target, _pole, 1, true);
    setBoneWorldQuaternion(b("hand_l"), _handQuat, true);
  }
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
