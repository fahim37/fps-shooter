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

/** Meters from your position to the edge of the minimap, which follows you like PUBG's. */
export const MINIMAP_RANGE = 34;
/** Grid spacing drawn on the minimap, in meters. */
export const MINIMAP_GRID = 10;

/** Where a world point lands on the player-centered minimap (SVG units; 50, 50 is you). */
export function viewPoint(x: number, z: number, cx: number, cz: number, range = MINIMAP_RANGE) {
  const scale = 45 / range;
  return { x: 50 + (x - cx) * scale, y: 50 + (z - cz) * scale };
}

/** A point outside the frame pulled onto its edge, so squadmates out of range stay findable. */
export function toFrame(point: { x: number; y: number }, inset = 4) {
  const dx = point.x - 50, dy = point.y - 50, limit = 50 - inset;
  const k = Math.max(Math.abs(dx), Math.abs(dy)) / limit;
  return k <= 1 ? { ...point, edge: false } : { x: 50 + dx / k, y: 50 + dy / k, edge: true };
}

/**
 * A fading enemy mark, like PUBG's: where an enemy just fired from, or a footprint left by an
 * enemy sprinting nearby.
 */
export interface MapMark {
  key: string;
  kind: "shot" | "step";
  x: number;
  z: number;
  /** Direction of travel (player yaw convention), for footprints. */
  yaw: number;
  /** Footprints alternate feet. */
  left?: boolean;
  at: number;
}

export const MARK_MS: Record<MapMark["kind"], number> = { shot: 2800, step: 2000 };
/** Gunfire shows from anywhere on the map; footsteps only when the sprinter is this close. */
export const STEP_REVEAL_RANGE = 40;
const MAX_MARKS = 48;

export function addMark(marks: MapMark[], next: MapMark): MapMark[] {
  // A shooter's newest shot replaces their last one; footprints build up into a trail.
  const kept = marks.filter((mark) => next.at - mark.at < MARK_MS[mark.kind] && !(next.kind === "shot" && mark.kind === "shot" && mark.key === next.key));
  return [...kept, next].slice(-MAX_MARKS);
}

/** 0..1 opacity of a mark: full while fresh, fading out over its lifetime. */
export function markStrength(mark: MapMark, now: number) {
  const age = (now - mark.at) / MARK_MS[mark.kind];
  return age < 0 ? 1 : age >= 1 ? 0 : 1 - age * age;
}
