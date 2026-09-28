import type { WeaponId } from "./weapons";
import type { GameMode } from "./constants";
import type { HitPart } from "./hitboxes";

/** Options passed when creating or joining a room. */
export interface JoinOptions {
  name: string;
  /** 0 = male, 1 = female character. */
  char: number;
  create?: {
    mode: GameMode;
    maxPlayers: number;
    bots: number;
    botSkill: 0 | 1 | 2;
    private: boolean;
    roomName: string;
  };
}

/** Room metadata shown in the public room list. */
export interface RoomMeta {
  mode: GameMode;
  roomName: string;
  code: string;
  humans: number;
  bots: number;
}

// Player state flag bits (PlayerState.flags).
export const F_CROUCH = 1;
export const F_ADS = 2;
export const F_SPRINT = 4;
export const F_GROUNDED = 8;
export const F_RELOADING = 16;

// ----- client → server -----

export interface PoseMsg {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  flags: number;
  weapon: WeaponId;
  /** Landing impact speed since the last message (fall damage). */
  land?: number;
}

export interface FireMsg {
  weapon: WeaponId;
  /** Server-clock time of what the shooter was looking at (render time). */
  viewTime: number;
  origin: [number, number, number];
  /** One unit direction per pellet. */
  dirs: [number, number, number][];
}

export interface GrenadeMsg {
  origin: [number, number, number];
  dir: [number, number, number];
  /** Milliseconds the grenade was held (cooked) before throwing. */
  cooked: number;
}

export interface LoadoutMsg {
  primary: WeaponId;
}

// ----- server → client -----

export interface ShotEvent {
  id: string;
  weapon: WeaponId;
  origin: [number, number, number];
  /** End point of each pellet (impact or max range). */
  ends: [number, number, number][];
  /** Which ends hit map geometry (for impact effects). */
  impacts: boolean[];
}

export interface HitConfirm {
  target: string;
  damage: number;
  part: HitPart;
  killed: boolean;
}

export interface DamagedEvent {
  from: [number, number, number];
  damage: number;
  hp: number;
}

export interface KillEvent {
  killer: string;
  victim: string;
  weapon: WeaponId | "grenade" | "fall";
  headshot: boolean;
  /** Killer's streak after this kill. */
  streak: number;
}

export interface SpawnEvent {
  x: number; y: number; z: number;
  yaw: number;
  primary: WeaponId;
}

export interface ExplosionEvent {
  id: number;
  x: number; y: number; z: number;
}

export interface Pong {
  c: number;
  s: number;
}
