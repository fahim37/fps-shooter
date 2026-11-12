import * as THREE from "three";
import { instantiateCharacter, type CharacterTemplate, type CharacterInstance, type ClipName } from "../assets/characters";
import { cloneWeapon, createShell, SHELL_SEATS, WEAPON_META, WEAPON_PARTS, type WeaponTemplates } from "../assets/weapons";
import type { WeaponId } from "../../shared/weapons";
import { solveTwoBone, setBoneWorldQuaternion, rotateBoneWorld } from "./ik";
import { LEAN_ANGLE } from "../../shared/lean";
import { SLIDE_LEG_YAW } from "../../shared/hitboxes";
import { DEFAULT_OPTICS, OPTICS, type OpticId } from "../../shared/optics";
import { createIronSights, createReflexSight } from "./ReflexSight";
import { gripPose, type GripPose, type HandPose } from "./grip";
import { createHandling, sampleHandling, type HandBlend, type HandKey } from "./handling";
import type { QuickScope } from "./quickScope";
import { Recoil } from "./recoil";

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
  /** 0..1 through a slide out of a sprint. */
  slide?: number;
  grounded: boolean;
  alive: boolean;
  sprint: number;
  ads: number;
  /** FPP: the drawn gun's quick-scope move while raising or dropping the sights. */
  quickScope?: QuickScope;
  optic?: OpticId;
  /** -1 when not reloading, else progress 0..1. */
  reload: number;
  /** FPP view-space offsets for bob and sway. */
  bob?: THREE.Vector2;
  sway?: THREE.Vector2;
  /** 0..1 pull-back when facing a wall (FPP). */
  tuck?: number;
  /** 0..1 grenade throw motion. */
  throwing?: number;
  /**
   * FPP: the right hand leaves the gun to hold a grenade, `weight` of the way: the hand bone placed
   * at `offset` and turned to `turn`, both in view space. `left`, likewise, takes the support hand
   * off the gun to pull the pin.
   */
  grenade?: HandOverride & { left?: HandOverride };
  /** Peek -1 (left) .. 1 (right). */
  lean?: number;
  /** Seconds since the last shot (the gun's kick, pump / bolt cycling) and since the gun was drawn. */
  sinceShot?: number;
  sinceDraw?: number;
  /** Full-body emote to play instead of holding the gun. */
  emote?: ClipName | null;
}

/** A hand bone placed at `offset` and turned to `turn` in view space, `weight` of the way from the gun. */
export interface HandOverride { weight: number; offset: THREE.Vector3; turn: THREE.Quaternion }

const headCache = new WeakMap<CharacterTemplate, THREE.Vector3>();
const LOCO: ClipName[] = ["idle", "walk", "jog", "sprint", "crouchIdle", "crouchWalk", "jumpLoop", "slideLoop"];
const FPP_VISIBLE = /Arms/;
const PROCEDURAL_BONES = ["spine_01", "spine_03", "neck_01", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l"];
const BOLT_TRAVEL = 0.065;
/** How far a revolver's hammer rolls back from its fallen position (rad). */
const COCK_ANGLE = 0.75;
/** Height of the middle of the sniper's scope above the weapon origin (m). */
const SNIPER_SCOPE_AXIS = 0.113;
/** Height of the rifle's rail scope's lens axis above the weapon origin (m), from its lenses in weapons.glb. */
const AR_SCOPE_AXIS = 0.1667;
/** How far the revolver is pushed out from the eye when aimed (m). */
const REVOLVER_ADS_REACH = 0.58;
/** Aim point above the top of the revolver (m): the target stands on the front sight, not behind the gun. */
const REVOLVER_HOLD = 0.014;
/** Size of a reflex sight when not aiming through it. */
const SIGHT_ON_GUN = 0.62;
/** Where a free hand hangs: below, out from and ahead of its shoulder (m). */
const BELT_DROP = 0.5, BELT_OUT = 0.1, BELT_AHEAD = 0.08;
/** Where a hand fetching a magazine or shell goes: down and in toward the belt. */
const POUCH_DROP = 0.3;
const POUCH_IN = 0.08;
/** Extra curl (rad per joint) of the right hand's fingers, from the gun grip, around a grenade. */
const GRENADE_FINGER_CURL = 0.45;
/** How far (rad) the trigger finger's middle joint closes as a shot breaks. */
const TRIGGER_PULL = 0.09;
/** A shot this long ago (s) or more is not one to kick for: the rig was hidden when it went off. */
const KICK_WITHIN = 0.2;
/** TPP: share of the first-person shove back and muzzle rise shown on a body seen from outside, and how far (rad per metre of shove) the chest rocks with it. */
const TPP_KICK_BACK = 0.6;
const TPP_KICK_RISE = 0.9;
const TPP_KICK_ROCK = 1.1;
/** Aiming, the stock is in the shoulder: this share of the hip-fire shove back is left. */
const AIMED_KICK_BACK = 0.6;
const GRENADE_CURLED = ["index", "middle", "ring", "pinky"].flatMap((f) => ["01", "02", "03"].map((k) => `${f}_${k}_r`));
const _unitZ = new THREE.Vector3(0, 0, 1);
const _unitX = new THREE.Vector3(1, 0, 0);
/** Crossfade (s) into and out of an emote. */
const EMOTE_FADE = 0.25;
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
/** Longest wrist reach, as a share of the arm, that still leaves the elbow clearly bent (~118°). */
const COMFORT_REACH = 0.855;
/** A pistol is pushed out on nearly straight arms (~155°). */
const PISTOL_REACH = 0.97;
/** How far (rad) the clavicle may swing to carry the shoulder after a far hand. */
const MAX_SHRUG = 0.5;
/** How far the eye sits behind an AR-pattern stock: its high, straight comb would fill the view from closer. */
const AR_EYE_RELIEF = 0.17;
/** Long-gun stance: chest turned right of the aim (rad) so the support shoulder leads. */
const RIFLE_STANCE = 0.28;
/** Ground speed (m/s) of each movement clip at normal playback, measured from its planted toe. */
const CLIP_SPEED = { walk: 1.04, jog: 6.2, sprint: 9.5, crouchWalk: 0.77 };
/** Movement clips switch from walking to running at this speed (m/s). */
const RUN_SPEED = 2.6;
/** Legs turn this far (rad) toward a sideways move; past BACKPEDAL they run the clip backwards. */
const MAX_LEG_YAW = 0.8;
const BACKPEDAL = (105 * Math.PI) / 180;
/** FPP: a slide cants the hip gun over (rad) and tucks it in and down (m). */
const SLIDE_CANT = 0.32;
/** TPP: how far back from upright (rad) the chest sits over a slide's leading legs. */
const SLIDE_LEAN_BACK = 0.42;
const SLIDE_TUCK = [-0.03, -0.028] as const;
/** Sprint plays no slower than this, so a slower sprint keeps a brisk stride rather than floating. */
const SPRINT_MIN_RATE = 0.95;
/** Chest lean (rad, from upright) held steady while moving on foot, plus more when running and sprinting. */
const CHEST_LEAN = 0.12;
const RUN_LEAN = 0.1;
const SPRINT_LEAN = 0.17;
/** Seconds after a shot before a moving rifleman drops back to a relaxed carry. */
const CARRY_AFTER_SHOT = 0.6;
/** How far out (m, beside a point 0.75 m below the shoulder) the long-gun support elbow points. */
const SUPPORT_ELBOW_OUT = 0.5;
/** TPP: the butt sits in the shoulder pocket, this far in from the shoulder joint. */
const STOCK_POCKET = 0.05;
/** TPP chest, seen from above, that a lowered gun's butt must stay out of (m). */
const TORSO_HALF_WIDTH = 0.15;
const TORSO_HALF_DEPTH = 0.12;
const TORSO_SKIN = 0.02;
/** TPP sprint carry: the butt (m: right, up, ahead of the upper chest) and the gun's turn (rad). */
const PORT_BUTT = [0.16, -0.32, 0.2] as const;
const PORT_PITCH = 0.8;
const PORT_YAW = 0.9;
const PORT_ROLL = -0.35;
/** TPP reload: the gun's move (m: right, up, back from where it's held) and turn (rad). */
const RELOAD_OUT = [0.28, -0.1, -0.05] as const;
const RELOAD_PITCH = 0.35;
const RELOAD_YAW = -0.12;
const RELOAD_ROLL = -0.6;

/** Head position in the aim pose, model space: the FPP body hangs from it behind the camera. */
function headRef(template: CharacterTemplate) {
  let head = headCache.get(template);
  if (head) return head;
  const inst = instantiateCharacter(template, 0);
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
  /** An optic modelled on the gun, up only when a magnified sight is chosen. */
  scope?: THREE.Object3D;
  cylinder?: THREE.Object3D;
  hammer?: THREE.Object3D;
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
  private emote: { name: ClipName; action: THREE.AnimationAction } | null = null;
  private head: THREE.Vector3;
  private grip: GripPose | null = null;
  private state: RigState | null = null;
  /** Finger bones in the grip's order; a body without one leaves a gap. */
  private fingers: { r: (THREE.Bone | undefined)[]; l: (THREE.Bone | undefined)[] } = { r: [], l: [] };
  private handling = createHandling();
  /** The gun's kick from shot to shot. A shot is one whenever `sinceShot` starts over. */
  private kick = new Recoil();
  private lastSinceShot = Infinity;
  private gunPivot = new THREE.Object3D();
  private guns = new Map<WeaponId, THREE.Object3D>();
  private parts = new Map<WeaponId, WeaponParts>();
  private sights = new Map<WeaponId, ReturnType<typeof createReflexSight>>();
  private irons: ReturnType<typeof createIronSights> | null = null;
  private weapon: WeaponId | null = null;
  private legYaw = 0;
  private stance = 0;
  /** 0..1 forward lean while moving fast and relaxed low-ready carry while moving (TPP). */
  private run = 0;
  private carry = 0;
  /**
   * 0..1 (TPP): moving upright on foot, when the chest is held steady over the stride; and
   * sprinting, when the whole body turns to the run and the rifle is carried across the chest.
   */
  private steady = 0;
  private follow = 0;
  /** 0..1 (TPP): sliding, when the chest is sat up over hips that the slide clip lays right back. */
  private slideK = 0;
  private dead = false;
  private deadTime = 0;
  private animationPose: { bone: THREE.Bone; quaternion: THREE.Quaternion }[];
  /** World-space muzzle position of the current weapon (for effects). */
  readonly muzzle = new THREE.Vector3();
  readonly muzzleDir = new THREE.Vector3();

  constructor(
    private template: CharacterTemplate,
    private weaponTemplates: WeaponTemplates,
    team: number,
    readonly mode: RigMode,
    /** The player's own rig, seen up close: it carries the detailed gun. */
    private near = false,
  ) {
    this.inst = instantiateCharacter(template, team);
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
      g = cloneWeapon(this.weaponTemplates, id, this.near);
      const sight = createReflexSight(id);
      g.add(sight.object);
      this.sights.set(id, sight);
      if (id === "ar") {
        this.irons = createIronSights();
        g.add(this.irons.object);
      }
      const parts: WeaponParts = { mag: g.getObjectByName("mag"), pump: g.getObjectByName("pump"), bolt: g.getObjectByName("bolt"), cylinder: g.getObjectByName("cylinder"), hammer: g.getObjectByName("hammer"), scope: g.getObjectByName("scope") };
      const seat = SHELL_SEATS[id];
      if (seat) {
        parts.shell = createShell(id === "pistol");
        parts.shell.scale.setScalar(seat.scale);
        parts.shell.visible = false;
        g.add(parts.shell);
      }
      this.parts.set(id, parts);
      if (this.mode === "fpp") g.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
      this.gunPivot.add(g);
      this.guns.set(id, g);
    }
    g.visible = true;
    this.kick.reset();
    this.grip = gripPose(id);
    const bones = (names: string[]) => names.map((n) => this.inst.bones.get(n));
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
        this.emote?.action.fadeOut(0.15);
        this.emote = null;
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

    if (this.updateEmote(s.emote ?? null)) {
      // The emote owns the whole body; the gun is put away.
      this.legYaw = 0;
      this.mixer.update(dt);
      this.captureAnimationPose();
      this.placeRoot(s, 0);
      return;
    }
    const sinceShot = s.sinceShot ?? -1;
    if (this.weapon && sinceShot >= 0 && sinceShot < KICK_WITHIN && sinceShot < this.lastSinceShot - 1e-4) this.kick.kick(this.weapon);
    this.lastSinceShot = sinceShot;
    this.kick.update(dt);
    if (this.mode === "tpp") this.updateLocomotion(dt, s);
    this.updateAimLayer(s);
    this.mixer.update(dt);
    this.captureAnimationPose();

    this.placeRoot(s, this.mode === "tpp" ? this.legYaw : 0);
    this.object.updateMatrixWorld(true);
    // Long guns are shot bladed: the chest turns right so the support arm can reach the
    // handguard with a bent elbow, and the head turns back onto the aim. Moving with the gun
    // lowered, the shoulders square up to the run.
    const stance = this.weapon && this.weapon !== "pistol" ? RIFLE_STANCE * (1 - Math.max(this.carry, this.follow)) : 0;
    this.stance += (stance - this.stance) * Math.min(1, dt * 10);
    const legYaw = this.mode === "tpp" ? this.legYaw : 0;
    // Sprinting, the whole body turns to the run; otherwise the chest stays on the aim.
    const facing = s.yaw + legYaw * this.follow;
    const twist = legYaw * (1 - this.follow);
    if (Math.abs(twist) > 1e-3 || this.stance > 1e-4) {
      // Legs face the movement direction; turn the torso back onto the aim.
      rotateBoneWorld(this.inst.bones.get("spine_01")!, _q.setFromAxisAngle(UP, -twist * 0.6 - this.stance * 0.4), true);
      rotateBoneWorld(this.inst.bones.get("spine_03")!, _q.setFromAxisAngle(UP, -twist * 0.4 - this.stance * 0.6), true);
      const neck = this.inst.bones.get("neck_01");
      if (neck && this.stance > 1e-4) rotateBoneWorld(neck, _q.setFromAxisAngle(UP, this.stance), true);
    }
    if (this.mode === "tpp" && this.slideK > 1e-3) this.steadyChest(s.yaw + legYaw, -SLIDE_LEAN_BACK, this.slideK);
    else if (this.mode === "tpp" && this.steady > 1e-3) this.steadyChest(facing, CHEST_LEAN + this.run, this.steady);
    if (this.mode === "tpp" && Math.abs(this.run) > 1e-3) {
      // The steadied chest leans into the stride by `run`; the neck takes it back so the head
      // keeps looking where the player aims.
      const neck = this.inst.bones.get("neck_01");
      if (neck) rotateBoneWorld(neck, _q.setFromAxisAngle(_v.set(-Math.cos(facing), 0, Math.sin(facing)), -this.run), true);
    }
    if (this.mode === "tpp" && this.kick.back > 1e-4) {
      // The shot shoves the shoulder: the chest rocks back about the hips' side-to-side axis.
      _v.set(-Math.cos(s.yaw), 0, Math.sin(s.yaw));
      rotateBoneWorld(this.inst.bones.get("spine_03")!, _q.setFromAxisAngle(_v, -this.kick.back * TPP_KICK_ROCK), true);
    }
    const lean = s.lean ?? 0;
    if (this.mode === "tpp" && Math.abs(lean) > 1e-3) {
      // Peek: tilt the torso around the aim axis from the hips, matching the shared hitboxes.
      _v.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      rotateBoneWorld(this.inst.bones.get("spine_01")!, _q.setFromAxisAngle(_v, lean * LEAN_ANGLE * 0.75), true);
      rotateBoneWorld(this.inst.bones.get("spine_03")!, _q.setFromAxisAngle(_v, lean * LEAN_ANGLE * 0.25), true);
    }
    this.placeGun(s);
    this.state = s;
    this.solveArms();
  }

  /** Starts, switches or ends a full-body emote; true while one plays. */
  private updateEmote(name: ClipName | null) {
    const clip = name ? this.template.full.get(name) : undefined;
    const want = clip ? name : null;
    if (want === (this.emote?.name ?? null)) return !!this.emote;
    const was = this.emote;
    was?.action.fadeOut(EMOTE_FADE);
    this.emote = null;
    if (clip && want) {
      this.emote = { name: want, action: this.mixer.clipAction(clip).reset().setEffectiveWeight(1).fadeIn(EMOTE_FADE).play() };
      if (!was) for (const a of [...this.loco.values(), ...Object.values(this.aim)]) a.fadeOut(EMOTE_FADE);
    } else {
      for (const a of [...this.loco.values(), ...Object.values(this.aim)]) a.reset().play();
    }
    this.gunPivot.visible = !this.emote;
    return !!this.emote;
  }

  /**
   * TPP: the run clips pitch and rock the hips with every stride, and the upper body, posed by
   * the aim layer, rides along stiffly on top. Swings the spine from the hips so the chest
   * points `lean` ahead of upright instead (`weight` of the way): a level, steady carriage over
   * the legs. A slide uses it the other way, to sit the chest up over hips its clip lays right back.
   */
  private steadyChest(facing: number, lean: number, weight: number) {
    const spine = this.inst.bones.get("spine_01")!;
    const chest = _ta.setFromMatrixPosition(this.inst.bones.get("neck_01")!.matrixWorld)
      .sub(_tb.setFromMatrixPosition(spine.matrixWorld)).normalize();
    const want = _v.set(-Math.sin(facing) * Math.sin(lean), Math.cos(lean), -Math.cos(facing) * Math.sin(lean));
    _q.setFromUnitVectors(chest, want);
    rotateBoneWorld(spine, _q2.identity().slerp(_q, weight), true);
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
    const sliding = moving && (s.slide ?? 0) > 0.5;
    let rel = wrapAngle(s.moveYaw - s.yaw);
    let backwards = false;
    if (Math.abs(rel) > BACKPEDAL && !sliding) {
      backwards = true;
      rel = wrapAngle(rel - Math.PI);
    }
    const sprinting = moving && !s.crouch && !backwards && s.sprint * (1 - s.ads) > 0.5;
    this.follow += ((sprinting ? 1 : 0) - this.follow) * Math.min(1, dt * 7);
    this.steady += ((moving && !s.crouch ? 1 : 0) - this.steady) * Math.min(1, dt * 6);
    this.slideK += ((sliding ? 1 : 0) - this.slideK) * Math.min(1, dt * 14);
    // A sprint turns the whole body, so the legs may face any forward-going run.
    const maxLeg = sliding ? SLIDE_LEG_YAW : MAX_LEG_YAW + (Math.PI / 2 - MAX_LEG_YAW) * this.follow;
    const targetLeg = moving ? THREE.MathUtils.clamp(rel, -maxLeg, maxLeg) : 0;
    this.legYaw += (targetLeg - this.legYaw) * Math.min(1, dt * 8);

    // Clips play at the rate that keeps the planted foot still on the ground. The walk and
    // crouch clips have short steps, so faster moves speed them up past normal more.
    let pick: ClipName;
    const minRate = 0.6;
    let rate = 1, maxRate = 1.6;
    if (!s.grounded) pick = "jumpLoop";
    else if (sliding) pick = "slideLoop";
    else if (s.crouch) { pick = moving ? "crouchWalk" : "crouchIdle"; rate = s.speed / CLIP_SPEED.crouchWalk; maxRate = 2.4; }
    else if (!moving) pick = "idle";
    else if (s.speed < RUN_SPEED) { pick = "walk"; rate = s.speed / CLIP_SPEED.walk; maxRate = 2.2; }
    else if (s.speed < 6.6 || backwards) { pick = "jog"; rate = s.speed / CLIP_SPEED.jog; }
    else { pick = "sprint"; rate = Math.max(SPRINT_MIN_RATE, s.speed / CLIP_SPEED.sprint); }

    const running = moving && !s.crouch && s.speed >= RUN_SPEED;
    const lean = running ? (pick === "sprint" ? SPRINT_LEAN : RUN_LEAN) * (backwards ? -0.4 : 1) : 0;
    this.run += (lean - this.run) * Math.min(1, dt * 6);
    const sinceShot = s.sinceShot ?? -1;
    const relaxed = moving && !sliding && s.ads < 0.5 && s.reload < 0 && s.sprint < 0.5 && !(sinceShot >= 0 && sinceShot < CARRY_AFTER_SHOT);
    // Raising the gun to fire is quicker than lowering it again.
    this.carry += ((relaxed ? 1 : 0) - this.carry) * Math.min(1, dt * (relaxed ? 4 : 14));

    // A slide is over in a second: it is dropped into and stood up out of quicker than a gait changes.
    const k = Math.min(1, dt * (sliding || this.locoWeights.get("slideLoop")! > 0.05 ? 16 : 9));
    for (const [name, a] of this.loco) {
      const target = name === pick ? 1 : 0;
      const blended = this.locoWeights.get(name)! + (target - this.locoWeights.get(name)!) * k;
      // Three evaluates every track for any positive weight, however tiny. Finish
      // the fade so previously used movement clips don't keep costing CPU forever.
      const w = Math.abs(blended - target) < 0.001 ? target : blended;
      this.locoWeights.set(name, w);
      a.setEffectiveWeight(w);
      if (name === pick && name !== "idle" && name !== "crouchIdle" && name !== "jumpLoop" && name !== "slideLoop") {
        a.timeScale = THREE.MathUtils.clamp(rate, minRate, maxRate) * (backwards ? -1 : 1);
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
    const optic = s.optic ?? DEFAULT_OPTICS[w];
    const reflex = optic === "red-dot";
    sight.object.visible = reflex;
    // Compact on the gun; only the aiming player needs the full window, as the sight comes up to the eye.
    sight.object.scale.setScalar(this.mode === "fpp" ? THREE.MathUtils.lerp(SIGHT_ON_GUN, 1, THREE.MathUtils.smoothstep(s.ads, 0.3, 1)) : SIGHT_ON_GUN);
    const irons = w === "ar" ? this.irons : null;
    if (irons) irons.object.visible = optic === "iron";
    const scope = this.parts.get(w)?.scope;
    const scoped = !!scope && OPTICS[optic].zoom > 1;
    if (scope) scope.visible = scoped;
    const h = sampleHandling(w, s.reload, s.sinceShot ?? -1, s.sinceDraw ?? -1, this.handling);
    const [hx, hy, hz, hPitch, hYaw, hRoll] = h.gun;
    // A reload is held up in view even on the run: the sprint pose would carry it off the screen.
    const reloading = THREE.MathUtils.smoothstep(s.reload, 0, 0.1) * (1 - THREE.MathUtils.smoothstep(s.reload, 0.9, 1));
    const sprint = s.sprint * (1 - s.ads) * (1 - reloading);
    const slide = (s.slide ?? 0) * (1 - s.ads) * (1 - reloading);

    if (this.mode === "fpp" && s.eye && s.view) {
      // View-space placement: hip at the lower right, ADS lines the sights up with the eye.
      // Eye just above the top of the receiver / rear sight.
      const sightY = reflex ? sight.height : scoped ? AR_SCOPE_AXIS : irons ? irons.height : pistol ? meta.max[1] + REVOLVER_HOLD : w === "sniper" ? SNIPER_SCOPE_AXIS : meta.max[1] + 0.004;
      const hip = pistol ? _v.set(0.13, -0.21, -0.4) : _v.set(0.15, -0.25, -0.3);
      // Keep the stock end just in front of the eye; the pistol is held out at arm's length, small enough
      // on screen not to hide a target.
      const ads = _v2.set(0, -sightY, pistol ? -REVOLVER_ADS_REACH : -(meta.max[2] + (w === "ar" || w === "smg" ? AR_EYE_RELIEF : 0.07)));
      const qs = s.quickScope;
      const kick = this.kick, kickTurn = kick.aimed(s.ads), kickBack = 1 - (1 - AIMED_KICK_BACK) * s.ads;
      hip.lerp(ads, qs ? qs.lift : s.ads);
      hip.x += (s.sway?.x ?? 0) + (s.bob?.x ?? 0) + hx - sprint * 0.04 + slide * SLIDE_TUCK[0];
      hip.y += (s.sway?.y ?? 0) + (s.bob?.y ?? 0) + hy - sprint * 0.05 - (s.throwing ?? 0) * 0.75 - (qs?.dip ?? 0) + slide * SLIDE_TUCK[1] + kick.up * kickBack;
      hip.z += kick.back * kickBack + (s.tuck ?? 0) * 0.16 + hz;
      _e.set(
        kick.pitch * kickTurn + hPitch - sprint * 0.55 - (s.tuck ?? 0) * 0.7,
        sprint * 0.75 + hYaw + (qs?.yaw ?? 0) + kick.yaw * kickTurn,
        hRoll + sprint * 0.25 - (qs?.roll ?? 0) + slide * SLIDE_CANT + kick.roll * kickTurn,
        "YXZ",
      );
      _q.copy(s.view).multiply(_q2.setFromEuler(_e));
      this.gunPivot.position.copy(s.eye).add(hip.applyQuaternion(s.view));
      this.gunPivot.quaternion.copy(_q);
    } else {
      // Stock in the right shoulder, pointing along the aim (or, sprinting, along the run).
      const run = this.mode === "tpp" ? this.follow : sprint;
      const yaw = s.yaw + this.legYaw * this.follow;
      const shoulder = _v.setFromMatrixPosition(this.inst.bones.get(pistol ? "neck_01" : "upperarm_r")!.matrixWorld);
      // Moving without aiming, the gun rides lower with the muzzle dipped (low ready). A sprint
      // dips the pistol further; long guns go across the chest instead (portArms).
      const carry = this.carry * (1 - run);
      const dip = pistol ? run : 0;
      // Reloading, the gun comes down to the right of the body and cants over, so the mag change
      // shows from the over-the-shoulder camera instead of happening behind the chest.
      const tilt = s.reload >= 0 ? THREE.MathUtils.smoothstep(s.reload, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(s.reload, 0.88, 1)) * (pistol ? 0.5 : 1) : 0;
      const kick = this.kick;
      _e.set(s.pitch * (1 - tilt * 0.7) + kick.pitch * TPP_KICK_RISE + hPitch * 0.5 - dip * 0.6 - carry * (pistol ? 0.25 : 0.5) - tilt * RELOAD_PITCH,
        yaw + dip * 0.6 + hYaw + carry * 0.12 + tilt * RELOAD_YAW + kick.yaw, hRoll - (s.lean ?? 0) * LEAN_ANGLE * 0.6 + tilt * RELOAD_ROLL + kick.roll, "YXZ");
      _q.setFromEuler(_e);
      const fwd = _v2.set(0, 0, -1).applyQuaternion(_q);
      const reach = pistol ? 0.43 : meta.max[2] + 0.02;
      shoulder.addScaledVector(fwd, reach - kick.back * TPP_KICK_BACK);
      shoulder.y += (pistol ? -0.06 : -0.035) + s.ads * 0.03 - dip * 0.12 - carry * 0.1;
      // Handling lifts the gun into the first-person view; seen from outside, the same move
      // lowers it in front of the chest, the stock dropping toward the right armpit. It never
      // comes back toward the body: the first-person pull toward the eye would bury the stock.
      const lift = Math.max(0, hy) * 1.5;
      shoulder.add(_v2.set(hx * 0.5 + (pistol ? 0.02 : -STOCK_POCKET) + lift * 0.3 + tilt * RELOAD_OUT[0], Math.min(0, hy) - lift * 1.1 + tilt * RELOAD_OUT[1], Math.min(0, hz) - lift * 0.4 + tilt * RELOAD_OUT[2]).applyAxisAngle(UP, yaw));
      this.gunPivot.position.copy(shoulder);
      this.gunPivot.quaternion.copy(_q);
      if (!pistol && run > 1e-3) this.portArms(run, yaw, meta.max[2]);
      if (!pistol) this.clearTorso(meta.max[2], yaw);
    }
    this.placeParts();
    this.gunPivot.updateMatrixWorld(true);
    this.muzzle.set(...meta.muzzle).applyMatrix4(this.gunPivot.matrixWorld);
    this.muzzleDir.set(0, 0, -1).applyQuaternion(this.gunPivot.quaternion);
  }

  /**
   * TPP sprint, `k` of the way: a long gun carried diagonally across the chest, butt low at the
   * right hip and muzzle up past the left shoulder, as soldiers run with a rifle.
   */
  private portArms(k: number, yaw: number, stock: number) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const butt = _ta.setFromMatrixPosition(this.inst.bones.get("spine_03")!.matrixWorld)
      .add(_tb.set(fx * PORT_BUTT[2] - fz * PORT_BUTT[0], PORT_BUTT[1], fz * PORT_BUTT[2] + fx * PORT_BUTT[0]));
    _q.setFromEuler(_e.set(PORT_PITCH, yaw + PORT_YAW, PORT_ROLL, "YXZ"));
    // The butt sits `stock` behind the gun's origin.
    butt.add(_tb.set(0, 0, -stock).applyQuaternion(_q));
    this.gunPivot.position.lerp(butt, k);
    this.gunPivot.quaternion.slerp(_q, k);
  }

  /**
   * TPP: slides the gun forward along the aim until its butt is outside the chest. The torso is
   * an ellipse around the upper spine (seen from above), between the hips and the neck.
   */
  private clearTorso(stock: number, yaw: number) {
    const chest = _ta.setFromMatrixPosition(this.inst.bones.get("spine_03")!.matrixWorld);
    const hips = this.inst.bones.get("pelvis")!.matrixWorld.elements[13];
    const butt = _tb.set(0, 0, stock).applyQuaternion(this.gunPivot.quaternion).add(this.gunPivot.position);
    if (butt.y < hips - 0.1 || butt.y > chest.y + 0.3) return;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const dx = butt.x - chest.x, dz = butt.z - chest.z;
    const side = (dx * -fz + dz * fx) / TORSO_HALF_WIDTH;
    if (Math.abs(side) >= 1) return;
    const ahead = dx * fx + dz * fz;
    const push = TORSO_HALF_DEPTH * Math.sqrt(1 - side * side) + TORSO_SKIN - ahead;
    if (push > 0) this.gunPivot.position.add(_v2.set(fx * push, 0, fz * push));
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
      parts.bolt.position.set(...spec.bolt.pivot).addScaledVector(_v.set(...spec.bolt.axis), h.boltPull * BOLT_TRAVEL + h.charge);
    }
    if (parts.cylinder) parts.cylinder.rotation.z = -h.cylinder * Math.PI / 3;
    if (parts.hammer) parts.hammer.rotation.x = (1 - h.hammer) * COCK_ANGLE;
    if (parts.shell) {
      parts.shell.visible = h.shellHeld;
      parts.shell.quaternion.identity();
      const seat = SHELL_SEATS[w]!;
      parts.shell.position.set(...seat.port).addScaledVector(_v.set(...seat.axis), -h.shell);
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
    this.placeHand("r", this.grenadeHand(this.handTarget(h.right, grip.right, bodyLeft), this.state?.grenade), _pole, comfort);
    // The support elbow hangs down and a little out, so the forearm meets the handguard on a
    // diagonal and the wrist turns under it instead of continuing the forearm's line.
    _pole.setFromMatrixPosition(b("upperarm_l").matrixWorld).addScaledVector(bodyLeft, w === "pistol" ? 0.06 : SUPPORT_ELBOW_OUT).addScaledVector(DOWN, 0.75);
    this.placeHand("l", this.grenadeHand(this.handTarget(h.left, grip.left, bodyLeft), this.state?.grenade?.left), _pole, comfort);

    // Fingers are written absolutely each frame, so held clips cannot accumulate them.
    this.poseFingers(this.fingers.r, h.right, grip.right);
    // The trigger finger squeezes as each shot breaks, and lets off after it.
    if (this.kick.trigger > 1e-3 && h.right.a.pose === "grip" && (h.right.k === 0 || h.right.b.pose === "grip")) {
      this.inst.bones.get("index_02_r")?.quaternion.multiply(_q.setFromAxisAngle(_unitX, this.kick.trigger * TRIGGER_PULL));
    }
    // Around a grenade the fingers curl over its top (about each bone's Z, toward the palm).
    const nade = this.mode === "fpp" ? this.state?.grenade?.weight ?? 0 : 0;
    if (nade > 0) {
      _q.setFromAxisAngle(_unitZ, nade * GRENADE_FINGER_CURL);
      for (const name of GRENADE_CURLED) this.inst.bones.get(name)?.quaternion.multiply(_q);
    }
    this.poseFingers(this.fingers.l, h.left, grip.left);
    b("hand_r").updateMatrixWorld(true);
    b("hand_l").updateMatrixWorld(true);

    const parts = this.parts.get(w)!;
    if (h.magHeld && parts.mag && grip.left.mag) this.holdInLeftHand(parts.mag, grip.left.mag);
    if (h.shellHeld && parts.shell && grip.left.shell) this.holdInLeftHand(parts.shell, grip.left.shell);
  }

  /** A hand's target moved off the gun for the grenade (FPP), as far as `g` says. */
  private grenadeHand(target: THREE.Matrix4, g: HandOverride | undefined) {
    const s = this.state;
    if (this.mode !== "fpp" || !g || g.weight <= 1e-3 || !s?.eye || !s.view) return target;
    target.decompose(_ta, _qa, _scale);
    _tb.copy(g.offset).applyQuaternion(s.view).add(s.eye);
    _qb.copy(s.view).multiply(g.turn);
    _ta.lerp(_tb, g.weight);
    _qa.slerp(_qb, g.weight);
    return target.compose(_ta, _qa, _s);
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
    if (key.pull || key.clear || key.drop) _m.multiply(_m2.makeTranslation(-(key.clear ?? 0), -(key.drop ?? 0), key.pull ?? 0));
    _m.multiply(pose.matrix);
    _m.decompose(pos, quat, _scale);
    if (key.belt) {
      const fwd = _v.set(0, 0, -1).applyQuaternion(this.gunPivot.quaternion).setY(0).normalize();
      pos.setFromMatrixPosition(this.inst.bones.get("upperarm_l")!.matrixWorld).addScaledVector(DOWN, BELT_DROP).addScaledVector(bodyLeft, BELT_OUT).addScaledVector(fwd, BELT_AHEAD);
      quat.setFromRotationMatrix(_m2.lookAt(_v2.set(0, 0, 0), DOWN, fwd));
    }
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

  private poseFingers<P extends string>(bones: (THREE.Bone | undefined)[], blend: HandBlend<P>, poses: Partial<Record<P, HandPose>>) {
    const a = poses[blend.a.pose]!.fingers, b = poses[blend.b.pose]!.fingers;
    for (let i = 0; i < bones.length; i++) if (a[i] && b[i]) bones[i]?.quaternion.slerpQuaternions(a[i], b[i], blend.k);
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
