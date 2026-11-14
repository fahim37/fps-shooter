import { DASH_SECONDS, DASH_SPEED } from "../game/shared/constants";

type V3 = [number, number, number];
type Direction = [number, number];

/** Include room to brake after the burst. */
export const BOT_DASH_DISTANCE = DASH_SECONDS * DASH_SPEED + 0.6;

export interface CombatSituation {
  position: V3;
  target: V3;
  preferredRange: number;
  defensive: boolean;
  underFire: boolean;
  canDash: boolean;
  /** Keep a useful strafe instead of changing direction every decision. */
  side: number;
}

export interface CombatMove {
  direction: Direction;
  dash: boolean;
}

/** Probe the entire route and return its endpoint and whether it hides us from the enemy. */
export type ProbeMove = (direction: Direction, distance: number) => { point: V3; covered: boolean } | null;

/** Tactical choices are scored from range, pressure and reachable cover; no random ability rolls. */
export function chooseCombatMove(s: CombatSituation, probe: ProbeMove): CombatMove | null {
  const dx = s.target[0] - s.position[0], dz = s.target[2] - s.position[2];
  const distance = Math.hypot(dx, dz);
  if (distance < 0.01) return null;
  const toward: Direction = [dx / distance, dz / distance];
  const left: Direction = [-toward[1], toward[0]];
  const directions: Direction[] = [left, [-left[0], -left[1]], [-toward[0], -toward[1]]];
  for (const side of [-1, 1]) for (const forward of [-1, 1]) {
    directions.push([(toward[0] * forward + left[0] * side) * Math.SQRT1_2,
      (toward[1] * forward + left[1] * side) * Math.SQRT1_2]);
  }
  directions.push(toward);
  const closing = distance > s.preferredRange + BOT_DASH_DISTANCE + 3;

  const pick = (dash: boolean, coverOnly = false): CombatMove | null => {
    let best: CombatMove | null = null, bestScore = -Infinity;
    const travel = dash ? BOT_DASH_DISTANCE : 2.5;
    for (const direction of directions) {
      const lateral = direction[0] * left[0] + direction[1] * left[1];
      const forward = direction[0] * toward[0] + direction[1] * toward[1];
      // Ordinary movement follows the navmesh to distant enemies. Never dash blindly around a bend.
      if (dash && !s.defensive && !s.underFire && forward < 0.9) continue;
      const result = probe(direction, travel);
      if (!result || (coverOnly && !result.covered)) continue;
      const endRange = Math.hypot(s.target[0] - result.point[0], s.target[2] - result.point[2]);
      const rangeGain = Math.abs(distance - s.preferredRange) - Math.abs(endRange - s.preferredRange);
      if (dash) {
        const escape = result.covered || (s.underFire && Math.abs(lateral) > 0.7 && endRange >= Math.min(distance, s.preferredRange * 0.65));
        const approach = closing && distance - endRange > travel * 0.6 && endRange >= s.preferredRange - 2;
        if (s.defensive ? !escape : s.underFire ? !escape && !approach : !approach) continue;
      }
      // A healthy bot keeps its weapon effective. A vulnerable one prioritizes cover and space.
      const score = s.defensive
        ? (result.covered ? 100 : 0) + (endRange - distance) * 1.5 - Math.max(0, s.preferredRange * 0.65 - endRange) * 4
        : rangeGain * 3 + (result.covered ? 10 : 0) + Math.abs(lateral) * 3;
      const continuity = lateral * s.side > 0 ? 0.4 : 0;
      if (score + continuity > bestScore) {
        bestScore = score + continuity;
        best = { direction, dash };
      }
    }
    return best;
  };

  // Reloading or low health alone is not an emergency. Save a charge when cover is a few steps away.
  if (s.defensive && !s.underFire) {
    const nearbyCover = pick(false, true);
    if (nearbyCover) return nearbyCover;
  }
  if (s.canDash && (s.defensive || s.underFire || closing)) {
    const dash = pick(true);
    if (dash) return dash;
  }
  if (distance > s.preferredRange + 6 && !s.defensive) return null;
  return pick(false) ?? { direction: [0, 0], dash: false };
}
