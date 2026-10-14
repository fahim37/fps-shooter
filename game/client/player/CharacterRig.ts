import * as THREE from "three";
import { instantiateCharacter, type CharacterTemplate, type CharacterInstance, type ClipName } from "../assets/characters";
import { cloneWeapon, createShell, SHELL_PORT, WEAPON_META, WEAPON_PARTS } from "../assets/weapons";
import type { WeaponId } from "../../shared/weapons";
import { solveTwoBone, setBoneWorldQuaternion, rotateBoneWorld } from "./ik";
import { LEAN_ANGLE } from "../../shared/lean";
import { DEFAULT_OPTICS, type OpticId } from "../../shared/optics";
import { createReflexSight } from "./ReflexSight";
import { gripPose, type GripPose, type HandPose } from "./grip";
import { createHandling, sampleHandling, type HandBlend, type HandKey } from "./handling";

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
  optic?: OpticId;
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
  /** Peek -1 (left) .. 1 (right). */
  lean?: number;
  /** Seconds since the last shot (pump / bolt cycling) and since the gun was drawn. */
  sinceShot?: number;
  sinceDraw?: number;
}

const headCache = new WeakMap<CharacterTemplate, THREE.Vector3>();
const LOCO: ClipName[] = ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "jumpLoop"];
const FPP_VISIBLE = /Arms/;
const PROCEDURAL_BONES = ["spine_01", "spine_03", "neck_01", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l"];
/** Bolt handle lift (rad) and travel (m) at full open. */
const BOLT_LIFT = 1.15;
const BOLT_TRAVEL = 0.065;
/** Where a hand fetching a magazine or shell goes: down and in toward the belt. */
const POUCH_DROP = 0.3;
const POUCH_IN = 0.08;
/** FPP: view-space offset of the hidden body from where the head would put it. */
const FPP_BODY_HIP = new THREE.Vector3(0, -0.14, -0.23);
const FPP_BODY_ADS = new THREE.Vector3(0, -0.08, -0.17);

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
const _twist = new THREE.Quaternion();
const _forearm = new THREE.Vector3();
const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _handTarget = new THREE.Matrix4();
/** Share of the wrist's roll taken by the forearm; there are no twist bones to spread it. */
const FOREARM_ROLL = 0.75;
/** Longest wrist reach, as a share of the arm, that still leaves the elbow softly bent (~135°). */
const COMFORT_REACH = 0.92;
/** A pistol is pushed out on nearly straight arms (~155°). */
const PISTOL_REACH = 0.97;
/** How far (rad) the clavicle may swing to carry the shoulder after a far hand. */
const MAX_SHRUG = 0.42;
/** Long-gun stance: chest turned right of the aim (rad) so the support shoulder leads. */
const RIFLE_STANCE = 0.28;
/** TPP: the butt sits in the shoulder pocket, this far in from the shoulder joint. */
const STOCK_POCKET = 0.05;

/** Head position in the aim pose, model space: the FPP body hangs from it behind the camera. */
function headRef(template: CharacterTemplate) {
  let head = headCache.get(template);
  if (head) return head;
  const inst = instantiateCharacter(template, 0, false);
  const mixer = new THREE.AnimationMixer(inst.root);
  mixer.clipAction(template.full.get("aimNeutral")!).play();
  mixer.update(0);
  inst.root.updateMatrixWorld(true);
  head = inst.bones.get("Head")!.getWorldPosition(new THREE.Vector3());
  mixer.stopAllAction();
  headCache.set(template, head);
  return head;
}

interface WeaponParts {
  mag?: THREE.Object3D;
  pump?: THREE.Object3D;
  bolt?: THREE.Object3D;
  shell?: THREE.Object3D;
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
  private head: THREE.Vector3;
  private grip: GripPose | null = null;
  private fingers: { r: THREE.Bone[]; l: THREE.Bone[] } = { r: [], l: [] };
  private handling = createHandling();
  private gunPivot = new THREE.Object3D();
  private guns = new Map<WeaponId, THREE.Object3D>();
  private parts = new Map<WeaponId, WeaponParts>();
  private sights = new Map<WeaponId, ReturnType<typeof createReflexSight>>();
  private weapon: WeaponId | null = null;
  private legYaw = 0;
  private stance = 0;
  private dead = false;
  private deadTime = 0;
  private animationPose: { bone: THREE.Bone; quaternion: THREE.Quaternion }[];
  /** World-space muzzle position of the current weapon (for effects). */
  readonly muzzle = new THREE.Vector3();
  readonly muzzleDir = new THREE.Vector3();

  constructor(
    private template: CharacterTemplate,
    private weaponTemplates: Map<WeaponId, THREE.Object3D>,
    team: number,
    beard: boolean,
    readonly mode: RigMode,
  ) {
    this.inst = instantiateCharacter(template, team, beard);
    this.animationPose = [...this.inst.bones.values()].filter((bone) => PROCEDURAL_BONES.includes(bone.name))
      .map((bone) => ({ bone, quaternion: bone.quaternion.clone() }));
    this.head = headRef(template);
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
      const sight = createReflexSight(id);
      g.add(sight.object);
      this.sights.set(id, sight);
      const parts: WeaponParts = { mag: g.getObjectByName("mag"), pump: g.getObjectByName("pump"), bolt: g.getObjectByName("bolt") };
      if (id === "shotgun") {
        parts.shell = createShell();
        parts.shell.visible = false;
        g.add(parts.shell);
      }
      this.parts.set(id, parts);
      if (this.mode === "fpp") g.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
      this.gunPivot.add(g);
      this.guns.set(id, g);
    }
    g.visible = true;
    this.grip = gripPose(this.template, id);
    const bones = (names: string[]) => names.map((n) => this.inst.bones.get(n)!);
    this.fingers = { r: bones(this.grip.fingers.r), l: bones(this.grip.fingers.l) };
  }

  setVisible(v: boolean) {
    this.object.visible = v;
  }

  /** Detaches from the scene. Animation state is kept, so a rig can be re-added. Sight geometry is shared. */
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
    // Long guns are shot bladed: the chest turns right so the support arm can reach the
    // handguard with a bent elbow, and the head turns back onto the aim.
    const stance = this.weapon && this.weapon !== "pistol" ? RIFLE_STANCE : 0;
    this.stance += (stance - this.stance) * Math.min(1, dt * 10);
    const legYaw = this.mode === "tpp" ? this.legYaw : 0;
    if (Math.abs(legYaw) > 1e-3 || this.stance > 1e-4) {
      // Legs face the movement direction; turn the torso back onto the aim.
      rotateBoneWorld(this.inst.bones.get("spine_01")!, _q.setFromAxisAngle(UP, -legYaw * 0.6 - this.stance * 0.4), true);
      rotateBoneWorld(this.inst.bones.get("spine_03")!, _q.setFromAxisAngle(UP, -legYaw * 0.4 - this.stance * 0.6), true);
      const neck = this.inst.bones.get("neck_01");
      if (neck && this.stance > 1e-4) rotateBoneWorld(neck, _q.setFromAxisAngle(UP, this.stance), true);
    }
    const lean = s.lean ?? 0;
    if (this.mode === "tpp" && Math.abs(lean) > 1e-3) {
      // Peek: tilt the torso around the aim axis from the hips, matching the shared hitboxes.
      _v.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      rotateBoneWorld(this.inst.bones.get("spine_01")!, _q.setFromAxisAngle(_v, lean * LEAN_ANGLE * 0.75), true);
      rotateBoneWorld(this.inst.bones.get("spine_03")!, _q.setFromAxisAngle(_v, lean * LEAN_ANGLE * 0.25), true);
    }
    this.placeGun(s);
    this.solveArms();
  }

  private captureAnimationPose() {
    for (const pose of this.animationPose) pose.quaternion.copy(pose.bone.quaternion);
  }

  private placeRoot(s: RigState, legYaw: number) {
    if (this.mode === "fpp" && s.eye && s.view) {
      // Head at the camera, body oriented with the view (only the arms are drawn).
      _q.copy(s.view).multiply(_q2.setFromAxisAngle(UP, Math.PI));
      this.body.quaternion.copy(_q);
      _v.copy(this.head).applyQuaternion(_q);
      // The body sits forward of and below the camera so the (hidden) shoulders can reach the
      // gun and the forearms rise into view; aiming brings the shoulders up behind the sights.
      _v2.copy(FPP_BODY_HIP).lerp(FPP_BODY_ADS, s.ads).applyQuaternion(s.view);
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
    const sight = this.sights.get(w)!;
    const reflex = (s.optic ?? DEFAULT_OPTICS[w]) === "red-dot";
    sight.object.visible = reflex;
    const h = sampleHandling(w, s.reload, s.sinceShot ?? -1, s.sinceDraw ?? -1, this.handling);
    const [hx, hy, hz, hPitch, hYaw, hRoll] = h.gun;
    const sprint = s.sprint * (1 - s.ads);

    if (this.mode === "fpp" && s.eye && s.view) {
      // View-space placement: hip at the lower right, ADS lines the sights up with the eye.
      // Eye just above the top of the receiver / rear sight.
      const sightY = reflex ? sight.height : pistol ? meta.max[1] - 0.004 : w === "sniper" ? meta.max[1] - 0.01 : meta.max[1] + 0.004;
      const hip = pistol ? _v.set(0.13, -0.21, -0.4) : _v.set(0.15, -0.25, -0.3);
      // Keep the stock end just in front of the eye; the pistol is held out at arm's length.
      const ads = _v2.set(0, -sightY, pistol ? -0.48 : -(meta.max[2] + 0.07));
      hip.lerp(ads, s.ads);
      hip.x += (s.sway?.x ?? 0) + (s.bob?.x ?? 0) + hx - sprint * 0.04;
      hip.y += (s.sway?.y ?? 0) + (s.bob?.y ?? 0) + hy - sprint * 0.05 - (s.throwing ?? 0) * 0.25;
      hip.z += s.recoil * 0.045 + (s.tuck ?? 0) * 0.16 + hz;
      _e.set(
        s.recoil * 0.06 + hPitch - sprint * 0.55 - (s.tuck ?? 0) * 0.7,
        sprint * 0.75 + hYaw,
        hRoll + sprint * 0.25,
        "YXZ",
      );
      _q.copy(s.view).multiply(_q2.setFromEuler(_e));
      this.gunPivot.position.copy(s.eye).add(hip.applyQuaternion(s.view));
      this.gunPivot.quaternion.copy(_q);
    } else {
      // Stock in the right shoulder, pointing along the aim.
      const shoulder = _v.setFromMatrixPosition(this.inst.bones.get(pistol ? "neck_01" : "upperarm_r")!.matrixWorld);
      _e.set(s.pitch + s.recoil * (pistol ? 0.075 : 0.035) + hPitch * 0.5 - sprint * 0.6, s.yaw + sprint * 0.6 + hYaw, hRoll - (s.lean ?? 0) * LEAN_ANGLE * 0.6, "YXZ");
      _q.setFromEuler(_e);
      const fwd = _v2.set(0, 0, -1).applyQuaternion(_q);
      const reach = pistol ? 0.43 : meta.max[2] + 0.02;
      shoulder.addScaledVector(fwd, reach - s.recoil * 0.015);
      shoulder.y += (pistol ? -0.06 : -0.035) + s.ads * 0.03 - sprint * 0.12;
      // Handling lifts the gun into the first-person view; seen from outside, the same move
      // brings it down and in to the chest.
      const lift = Math.max(0, hy) * 1.5;
      shoulder.add(_v2.set(hx + (pistol ? 0.02 : -STOCK_POCKET), Math.min(0, hy) - lift, hz + lift).applyAxisAngle(UP, s.yaw));
      this.gunPivot.position.copy(shoulder);
      this.gunPivot.quaternion.copy(_q);
    }
    this.placeParts();
    this.gunPivot.updateMatrixWorld(true);
    this.muzzle.set(...meta.muzzle).applyMatrix4(this.gunPivot.matrixWorld);
    this.muzzleDir.set(0, 0, -1).applyQuaternion(this.gunPivot.quaternion);
  }

  /** Seats the moving parts on the gun; held ones are moved with the hand after the IK. */
  private placeParts() {
    const w = this.weapon!;
    const parts = this.parts.get(w)!;
    const spec = WEAPON_PARTS[w];
    const h = this.handling;
    if (parts.mag && spec?.mag) {
      parts.mag.visible = h.magVisible;
      parts.mag.quaternion.identity();
      parts.mag.position.set(...spec.mag.pivot).addScaledVector(_v.set(...spec.mag.axis), h.mag);
    }
    if (parts.pump && spec?.pump) parts.pump.position.set(...spec.pump.pivot).addScaledVector(_v.set(...spec.pump.axis), h.pump);
    if (parts.bolt && spec?.bolt) {
      parts.bolt.position.set(...spec.bolt.pivot).addScaledVector(_v.set(...spec.bolt.axis), h.boltPull * BOLT_TRAVEL);
      parts.bolt.rotation.set(0, 0, h.boltLift * BOLT_LIFT);
    }
    if (parts.shell) {
      parts.shell.visible = h.shellHeld;
      parts.shell.quaternion.identity();
      parts.shell.position.set(SHELL_PORT[0], SHELL_PORT[1] - h.shell, SHELL_PORT[2]);
    }
  }

  private solveArms() {
    const w = this.weapon;
    const grip = this.grip;
    if (!w || !grip) return;
    const b = (n: string) => this.inst.bones.get(n)!;
    const h = this.handling;
    const bodyLeft = _bodyLeft.set(1, 0, 0).applyQuaternion(this.body.quaternion); // model +X is the character's left
    const comfort = w === "pistol" ? PISTOL_REACH : COMFORT_REACH;

    _pole.setFromMatrixPosition(b("upperarm_r").matrixWorld).addScaledVector(bodyLeft, -0.18).addScaledVector(DOWN, 0.75);
    this.placeHand("r", this.handTarget(h.right, grip.right, bodyLeft), _pole, comfort);
    _pole.setFromMatrixPosition(b("upperarm_l").matrixWorld).addScaledVector(bodyLeft, 0.06).addScaledVector(DOWN, 0.75);
    this.placeHand("l", this.handTarget(h.left, grip.left, bodyLeft), _pole, comfort);

    // Fingers are written absolutely each frame, so held clips cannot accumulate them.
    this.poseFingers(this.fingers.r, h.right, grip.right);
    this.poseFingers(this.fingers.l, h.left, grip.left);
    b("hand_r").updateMatrixWorld(true);
    b("hand_l").updateMatrixWorld(true);

    const parts = this.parts.get(w)!;
    if (h.magHeld && parts.mag && grip.left.mag) this.holdInLeftHand(parts.mag, grip.left.mag);
    if (h.shellHeld && parts.shell && grip.left.shell) this.holdInLeftHand(parts.shell, grip.left.shell);
  }

  /** Blended world transform for a hand moving between two grip poses. */
  private handTarget<P extends string>(blend: HandBlend<P>, poses: Partial<Record<P, HandPose>>, bodyLeft: THREE.Vector3) {
    this.keyTransform(blend.a, poses, bodyLeft, _ta, _qa);
    if (blend.k > 0 && blend.b !== blend.a) {
      this.keyTransform(blend.b, poses, bodyLeft, _tb, _qb);
      _ta.lerp(_tb, blend.k);
      _qa.slerp(_qb, blend.k);
    }
    return _handTarget.compose(_ta, _qa, _s);
  }

  private keyTransform<P extends string>(key: HandKey<P>, poses: Partial<Record<P, HandPose>>, bodyLeft: THREE.Vector3, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const pose = poses[key.pose]!;
    _m.copy(this.gunPivot.matrixWorld);
    const frame = this.frameObject(pose.frame);
    if (frame) _m.multiply(frame.matrix);
    if (key.pull) _m.multiply(_m2.makeTranslation(0, 0, key.pull));
    _m.multiply(pose.matrix);
    _m.decompose(pos, quat, _scale);
    if (key.pouch) {
      // Down to the belt and in toward the body, whichever way the gun is pointing.
      const fwd = _v.set(0, 0, -1).applyQuaternion(this.gunPivot.quaternion).setY(0).normalize();
      pos.addScaledVector(DOWN, POUCH_DROP * key.pouch).addScaledVector(fwd, -POUCH_IN * key.pouch).addScaledVector(bodyLeft, 0.05 * key.pouch);
    }
  }

  private frameObject(frame: HandPose["frame"]) {
    if (frame === "gun") return null;
    const o = this.parts.get(this.weapon!)![frame]!;
    o.updateMatrix();
    return o;
  }

  private poseFingers<P extends string>(bones: THREE.Bone[], blend: HandBlend<P>, poses: Partial<Record<P, HandPose>>) {
    const a = poses[blend.a.pose]!.fingers, b = poses[blend.b.pose]!.fingers;
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.slerpQuaternions(a[i], b[i], blend.k);
  }

  /** Moves a gun part so it sits in the left hand as it did when the hand closed on it. */
  private holdInLeftHand(part: THREE.Object3D, pose: HandPose) {
    _m.copy(this.gunPivot.matrixWorld).invert()
      .multiply(this.inst.bones.get("hand_l")!.matrixWorld)
      .multiply(_m2.copy(pose.matrix).invert());
    _m.decompose(part.position, part.quaternion, _scale);
  }

  /** Two-bone IK to a hand transform, rolling the forearm with the wrist so the skin doesn't pinch. */
  private placeHand(side: "r" | "l", target: THREE.Matrix4, pole: THREE.Vector3, comfort: number) {
    const upper = this.inst.bones.get(`upperarm_${side}`)!;
    const lower = this.inst.bones.get(`lowerarm_${side}`)!;
    const hand = this.inst.bones.get(`hand_${side}`)!;
    _target.setFromMatrixPosition(target);
    _handQuat.setFromRotationMatrix(_m2.extractRotation(target));
    const clavicle = this.inst.bones.get(`clavicle_${side}`);
    if (clavicle) this.reachShoulder(clavicle, upper, lower, hand, _target, comfort);
    solveTwoBone(upper, lower, hand, _target, pole, 1, true);
    _forearm.subVectors(_v.setFromMatrixPosition(hand.matrixWorld), _v2.setFromMatrixPosition(lower.matrixWorld)).normalize();
    // Twist of the wanted wrist rotation about the forearm, relative to where it is now.
    hand.getWorldQuaternion(_q).invert().premultiply(_handQuat);
    const d = _forearm.dot(_v.set(_q.x, _q.y, _q.z));
    _twist.set(_forearm.x * d, _forearm.y * d, _forearm.z * d, _q.w);
    if (_twist.lengthSq() > 1e-10) {
      _twist.normalize();
      if (_twist.w < 0) _twist.set(-_twist.x, -_twist.y, -_twist.z, -_twist.w);
      rotateBoneWorld(lower, _q.identity().slerp(_twist, FOREARM_ROLL), true);
    }
    setBoneWorldQuaternion(hand, _handQuat, true);
  }

  /**
   * A hand reaching past a comfortable bend brings its shoulder along, as the shoulder blade
   * does, so the elbow never locks straight. Swings the clavicle toward the target just enough.
   */
  private reachShoulder(clavicle: THREE.Bone, upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, share: number) {
    const root = _ta.setFromMatrixPosition(clavicle.matrixWorld);
    const shoulder = _tb.setFromMatrixPosition(upper.matrixWorld);
    const elbow = _v.setFromMatrixPosition(lower.matrixWorld);
    const comfort = (shoulder.distanceTo(elbow) + elbow.distanceTo(_v2.setFromMatrixPosition(hand.matrixWorld))) * share;
    if (shoulder.distanceTo(target) <= comfort) return;
    const bone = shoulder.sub(root);
    const toTarget = _v.subVectors(target, root);
    const c = bone.length(), d = toTarget.length();
    // Swinging by `a` leaves (full - a) between the clavicle and the target; keep the swing
    // that puts the shoulder exactly at comfortable reach.
    const full = bone.angleTo(toTarget);
    const rest = Math.acos(THREE.MathUtils.clamp((d * d + c * c - comfort * comfort) / (2 * d * c), -1, 1));
    const swing = Math.min(full - rest, MAX_SHRUG);
    const axis = _v2.crossVectors(bone, toTarget);
    if (swing <= 0 || axis.lengthSq() < 1e-10) return;
    rotateBoneWorld(clavicle, _q.setFromAxisAngle(axis.normalize(), swing), true);
  }
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
