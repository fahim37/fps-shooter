type V3 = [number, number, number];

/** Unit view direction for a yaw/pitch (yaw 0 looks toward -Z, positive pitch looks up). */
export function aimDir(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Yaw/pitch that look from `from` toward `to`. */
export function lookAt(from: V3, to: V3): { yaw: number; pitch: number } {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Random direction inside a cone of half-angle `coneDeg` around `dir`, uniform over the disc. */
export function spreadDir(dir: V3, coneDeg: number, rand: () => number = Math.random): V3 {
  if (coneDeg <= 0) return [...dir];
  const tan = Math.tan((coneDeg * Math.PI) / 180);
  // Orthonormal basis around dir.
  const up: V3 = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(dir, up));
  const v = cross(u, dir);
  const r = Math.sqrt(rand()) * tan;
  const a = rand() * Math.PI * 2;
  const x = Math.cos(a) * r, y = Math.sin(a) * r;
  return norm([dir[0] + u[0] * x + v[0] * y, dir[1] + u[1] * x + v[1] * y, dir[2] + u[2] * x + v[2] * y]);
}

export function angleBetween(a: V3, b: V3) {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
