import type { GameMode } from "../../shared/constants";

export interface MapPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  relation: "self" | "ally" | "enemy";
  /** Squad slot, for matching the minimap dot to the squad panel color. */
  slot?: number;
}

/** Where damage came from. Only the direction is shown, never the attacker's position or distance. */
export interface Threat {
  /** Attacker id; repeated hits from one attacker refresh a single indicator. */
  key: string;
  from: [number, number, number];
  at: number;
  /** Recent damage from this attacker, used for indicator intensity. */
  damage: number;
  kind: "bullet" | "explosion";
}

export const THREAT_MS = 3200;

export function addThreat(threats: Threat[], next: Threat): Threat[] {
  const previous = threats.find((threat) => threat.key === next.key && next.at - threat.at < THREAT_MS);
  const others = threats.filter((threat) => threat.key !== next.key && next.at - threat.at < THREAT_MS);
  // Older damage from the same attacker fades, so a fresh burst reads hotter than a stale one.
  const carried = previous ? previous.damage * (1 - (next.at - previous.at) / THREAT_MS) : 0;
  return [...others, { ...next, damage: next.damage + carried }].slice(-6);
}

/** Yaw that faces along a world direction (0 faces -Z, counterclockwise positive, like player yaw). */
export function bearingYaw(dx: number, dz: number) { return Math.atan2(-dx, -dz); }

/** Clockwise angle (radians) from the view direction to a bearing: 0 ahead, +π/2 to the right. */
export function relativeBearing(viewYaw: number, bearing: number) {
  const a = viewYaw - bearing;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 0..1 indicator strength: fades with age, stronger for heavier damage. */
export function threatStrength(threat: Threat, now: number) {
  const age = Math.max(0, (now - threat.at) / THREAT_MS);
  if (age >= 1) return 0;
  return (1 - age * age) * Math.min(1, 0.45 + threat.damage / 60);
}

export function mapPoint(x: number, z: number, half: number) {
  const project = (value: number) => 5 + Math.max(0, Math.min(1, (value + half) / (half * 2))) * 90;
  return { x: project(x), y: project(z) };
}

/** Game yaw is counterclockwise; an SVG's positive rotation is clockwise. */
export function mapHeading(yaw: number) { return -yaw * 180 / Math.PI; }

export function mapRelation(id: string, team: number, myId: string, myTeam: number, mode: GameMode): MapPlayer["relation"] {
  return id === myId ? "self" : mode === "tdm" && team === myTeam ? "ally" : "enemy";
}
