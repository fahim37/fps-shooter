/** Marking an enemy (Z): the mark follows them for a while, for the marker's whole team. */
type V3 = [number, number, number];

/** How long a mark stays on an enemy (ms), and the wait between one player's marks. */
export const SPOT_MS = 4500;
export const SPOT_COOLDOWN_MS = 700;
/** How far off an enemy can be marked (m). */
export const SPOT_RANGE = 160;
/** An enemy within this far of the crosshair (rad) is marked; up close, anyone within SPOT_NEAR m of the line of sight. */
export const SPOT_CONE = 0.07;
export const SPOT_NEAR = 0.9;
/** The server allows for the target having moved since the marker saw them. */
export const SPOT_SERVER_CONE = 0.35;

export interface SpotTarget { id: string; points: V3[] }

/** Angle (rad) between the view direction `dir` (unit) and the way from `origin` to `point`, and the distance. */
export function offAim(origin: V3, dir: V3, point: V3) {
  const d: V3 = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  const distance = Math.hypot(d[0], d[1], d[2]);
  if (distance < 1e-4) return { angle: 0, distance };
  const cos = (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / distance;
  return { angle: Math.acos(Math.max(-1, Math.min(1, cos))), distance };
}

/**
 * The enemy a mark lands on: the one nearest the crosshair that is in range, close enough to the
 * line of sight and in view (`visible` from the eye to one of their points). Null when there is none.
 */
export function pickSpot(origin: V3, dir: V3, targets: Iterable<SpotTarget>, visible: (from: V3, to: V3) => boolean, cone = SPOT_CONE) {
  let best: string | null = null, bestAngle = Infinity;
  for (const target of targets) {
    for (const point of target.points) {
      const { angle, distance } = offAim(origin, dir, point);
      if (distance > SPOT_RANGE || angle >= bestAngle) continue;
      if (angle > cone && !(angle < Math.PI / 2 && Math.sin(angle) * distance < SPOT_NEAR)) continue;
      if (!visible(origin, point)) continue;
      best = target.id; bestAngle = angle;
    }
  }
  return best;
}
