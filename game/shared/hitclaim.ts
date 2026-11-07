import { hitboxes, type HitPart, type Pose } from "./hitboxes";

type V3 = [number, number, number];

/**
 * How far (m) a claimed hit point may lie outside the server's rewound hitboxes. The shooter's
 * client tests the character as drawn (hit shapes on the animated skeleton); the server's
 * hitboxes only know position, stance, aim and lean, not the stride phase or the exact arm pose.
 * Measured gaps (scripts/dev/hit-accuracy.ts): the head bobs ~0.13 m from its mean while
 * running, hands on a rifle reach ~0.35 m past the torso, a striding foot ~0.3 m past the legs.
 */
export const CLAIM_SLACK: Record<HitPart, number> = { head: 0.17, body: 0.38, legs: 0.38 };
/** Collision differences between client and server along the shot (m). */
export const WALL_SLACK = 0.3;

/**
 * Whether the server accepts a client's claim that a pellet from `o` along unit `dir` hit
 * `part` of a player at distance `dist`, given that player's rewound pose and the distance to
 * the first wall (null: none in range).
 */
export function claimFits(o: V3, dir: V3, dist: number, part: HitPart, pose: Pose, wall: number | null, range: number) {
  if (!Number.isFinite(dist) || dist < 0 || dist > range) return false;
  if (wall !== null && dist > wall + WALL_SLACK) return false;
  const p: V3 = [o[0] + dir[0] * dist, o[1] + dir[1] * dist, o[2] + dir[2] * dist];
  const hb = hitboxes(pose);
  if (part === "head") return dist3(p, hb.head.c) <= hb.head.r + CLAIM_SLACK.head;
  const slack = CLAIM_SLACK[part];
  return dist3(p, hb.head.c) <= hb.head.r + slack
    || segDist(p, hb.body.a, hb.body.b) <= hb.body.r + slack
    || segDist(p, hb.legs.a, hb.legs.b) <= hb.legs.r + slack;
}

const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Distance from point `p` to segment a→b. */
function segDist(p: V3, a: V3, b: V3) {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2)) : 0;
  return dist3(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}
