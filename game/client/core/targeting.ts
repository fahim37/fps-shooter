import { rayVsPose, type HitPart, type Pose } from "../../shared/hitboxes";

type V3 = [number, number, number];
interface AimTarget {
  alive: boolean;
  team: number;
  protectedUntil: number;
  pose(): Pose;
}

/** Limit the enemy ray by the first world obstruction; teammates never count as targets. */
export function enemyAlongRay<T extends AimTarget>(origin: V3, dir: V3, maxDistance: number, targets: Iterable<T>, teamMode: boolean, myTeam: number, now: number) {
  let distance = maxDistance;
  let target: T | null = null;
  let part: HitPart = "body";
  for (const candidate of targets) {
    if (!candidate.alive || candidate.protectedUntil > now || (teamMode && candidate.team === myTeam)) continue;
    const hit = rayVsPose(origin, dir, distance, candidate.pose());
    if (hit && hit.distance < distance) { distance = hit.distance; target = candidate; part = hit.part; }
  }
  return { distance, target, part };
}
