import type { GameMode } from "../../shared/constants";

export interface MapPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  relation: "self" | "ally" | "enemy";
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
