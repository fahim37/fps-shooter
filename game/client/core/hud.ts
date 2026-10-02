import { create } from "zustand";
import type { WeaponId } from "../../shared/weapons";
import type { GameMode } from "../../shared/constants";

export interface KillFeedEntry {
  key: number;
  killer: string;
  killerTeam: number;
  victim: string;
  victimTeam: number;
  weapon: string;
  headshot: boolean;
  mine: boolean;
  at: number;
}

export interface ScoreRow {
  id: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  bot: boolean;
  alive: boolean;
  me: boolean;
  connected: boolean;
}

export type ConnState = "connecting" | "connected" | "reconnecting" | "error" | "left";

export interface HudState {
  conn: ConnState;
  error: string;
  loading: number;
  ready: boolean;

  myId: string;
  myTeam: number;
  alive: boolean;
  hp: number;
  weapon: WeaponId;
  primary: WeaponId;
  mag: number;
  reserve: number;
  grenades: number;
  reloading: number; // -1 or 0..1
  ads: number;
  spreadDeg: number;
  crosshairRadius: number;
  enemyInSight: boolean;
  cameraFov: number;
  scoped: boolean;
  thirdPerson: boolean;
  respawnAt: number;
  killedBy: { name: string; weapon: string } | null;
  protectedUntil: number;

  hitmarker: { at: number; head: boolean; kill: boolean; confirmed: boolean; damage: number };
  damage: { angle: number; at: number }[];
  hurtAt: number;
  killfeed: KillFeedEntry[];
  announce: { text: string; sub?: string; at: number } | null;

  mode: GameMode;
  phase: string;
  phaseEndsAt: number;
  serverOffset: number;
  team1: number;
  team2: number;
  scoreLimit: number;
  winner: string;
  code: string;
  roomName: string;
  players: ScoreRow[];

  locked: boolean;
  menu: boolean;
  loadoutOpen: boolean;
  customizingControls: boolean;
  scoreboard: boolean;
  touch: boolean;
  mobilePortrait: boolean;
  fps: number;
  ping: number;
  set: (patch: Partial<HudState>) => void;
}

export const useHud = create<HudState>((set) => ({
  conn: "connecting",
  error: "",
  loading: 0,
  ready: false,
  myId: "",
  myTeam: 0,
  alive: false,
  hp: 100,
  weapon: "ar",
  primary: "ar",
  mag: 0,
  reserve: 0,
  grenades: 0,
  reloading: -1,
  ads: 0,
  spreadDeg: 2,
  crosshairRadius: 12,
  enemyInSight: false,
  cameraFov: 78,
  scoped: false,
  thirdPerson: false,
  respawnAt: 0,
  killedBy: null,
  protectedUntil: 0,
  hitmarker: { at: 0, head: false, kill: false, confirmed: false, damage: 0 },
  damage: [],
  hurtAt: 0,
  killfeed: [],
  announce: null,
  mode: "tdm",
  phase: "warmup",
  phaseEndsAt: 0,
  serverOffset: 0,
  team1: 0,
  team2: 0,
  scoreLimit: 0,
  winner: "",
  code: "",
  roomName: "",
  players: [],
  locked: false,
  menu: false,
  loadoutOpen: false,
  customizingControls: false,
  scoreboard: false,
  touch: false,
  mobilePortrait: false,
  fps: 0,
  ping: 0,
  set: (patch) => set(patch),
}));

export const hud = () => useHud.getState();
