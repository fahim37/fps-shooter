/**
 * Player hitboxes and ray tests, shared by the server (authoritative hits) and the client
 * (instant hit feedback). Pose position is the feet.
 */

export interface Pose {
  x: number;
  y: number;
  z: number;
  crouch: boolean;
}

export type HitPart = "head" | "body" | "legs";

export interface PoseHit {
  distance: number;
  part: HitPart;
}

type V3 = [number, number, number];

export function hitboxes(p: Pose) {
  const c = p.crouch;
  return {
    head: { c: [p.x, p.y + (c ? 1.15 : 1.64), p.z] as V3, r: 0.16 },
    // End the torso below the head center so its rounded cap cannot swallow headshots.
    body: { a: [p.x, p.y + (c ? 0.62 : 1.0), p.z] as V3, b: [p.x, p.y + (c ? 0.82 : 1.32), p.z] as V3, r: 0.29 },
    legs: { a: [p.x, p.y + 0.12, p.z] as V3, b: [p.x, p.y + (c ? 0.6 : 0.98), p.z] as V3, r: 0.22 },
  };
}

/** Nearest hit of a ray (unit `dir`) against a player's hitboxes, within `maxDist`. */
export function rayVsPose(o: V3, dir: V3, maxDist: number, pose: Pose): PoseHit | null {
  // Cheap reject: bounding capsule around the whole body.
  const cheap = rayCapsule(o, dir, [pose.x, pose.y, pose.z], [pose.x, pose.y + 1.85, pose.z], 0.5);
  if (cheap === null || cheap > maxDist) return null;
  const hb = hitboxes(pose);
  let best: PoseHit | null = null;
  const consider = (t: number | null, part: HitPart) => {
    if (t !== null && t <= maxDist && (!best || t < best.distance)) best = { distance: t, part };
  };
  consider(raySphere(o, dir, hb.head.c, hb.head.r), "head");
  consider(rayCapsule(o, dir, hb.body.a, hb.body.b, hb.body.r), "body");
  consider(rayCapsule(o, dir, hb.legs.a, hb.legs.b, hb.legs.r), "legs");
  return best;
}

export function raySphere(o: V3, d: V3, c: V3, r: number): number | null {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? 0 : null; // origin inside the sphere
}

/** Ray vs capsule (segment a→b with radius r). */
export function rayCapsule(o: V3, d: V3, a: V3, b: V3, r: number): number | null {
  const ba: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const oa: V3 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const baba = dot(ba, ba), bard = dot(ba, d), baoa = dot(ba, oa), rdoa = dot(d, oa), oaoa = dot(oa, oa);
  if (baba < 1e-12) return raySphere(o, d, a, r);
  const closest = Math.max(0, Math.min(1, baoa / baba));
  const inside = oaoa - 2 * closest * baoa + closest * closest * baba;
  if (inside <= r * r) return 0;
  const aa = baba - bard * bard;
  let bb = baba * rdoa - baoa * bard;
  let cc = baba * oaoa - baoa * baoa - r * r * baba;
  let h = bb * bb - aa * cc;
  if (h >= 0 && aa > 1e-9) {
    const t = (-bb - Math.sqrt(h)) / aa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  // Caps.
  let best: number | null = null;
  for (const cap of [a, b]) {
    const oc: V3 = [o[0] - cap[0], o[1] - cap[1], o[2] - cap[2]];
    bb = dot(d, oc);
    cc = dot(oc, oc) - r * r;
    h = bb * bb - cc;
    if (h > 0) {
      const t = -bb - Math.sqrt(h);
      if (t >= 0 && (best === null || t < best)) best = t;
    }
  }
  return best;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
