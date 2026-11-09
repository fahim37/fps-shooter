import type { WeaponId } from "../../shared/weapons";
import { RED_DOT_ARRIVE, type OpticId } from "../../shared/optics";

/**
 * The first-person quick-scope move, for every gun: raising the sights, the gun flicks up with a
 * cant (rolling over and back as it swings in) and snaps onto the sight line with a small
 * overshoot that settles; lowering, it drops away with a lighter cant the other way.
 *
 * A red dot is seen through its glass the whole way up, where that swing reads as a wriggle: it
 * rises nearly straight, with a trace of the cant and no overshoot.
 *
 * Purely visual. It reshapes how the drawn gun travels over the same raise time; accuracy, zoom
 * and sensitivity still follow the plain ADS progress.
 */
export interface QuickScope {
  /** Hip (0) to sights (1) blend of the gun's position; briefly past 1 on the snap. */
  lift: number;
  /** Extra roll (rad, + clockwise as seen by the player) and yaw (rad) of the gun. */
  roll: number;
  yaw: number;
  /** Extra drop (m) of the gun below its path, mid-swing. */
  dip: number;
}

/** Peak cant (rad) mid-raise: long guns roll further than the revolver. */
const CANT: Record<WeaponId, number> = { ar: 0.34, smg: 0.38, shotgun: 0.3, sniper: 0.28, pistol: 0.26 };
/** How far past the sights the snap carries (back-ease constant; 1.4 peaks ~6% over). */
const SNAP = 1.4;
/** Share of the cant, yaw and dip kept behind a red dot. */
const RED_DOT_SWING = 0.15;

/**
 * `progress` is the linear ADS progress (0 hip .. 1 aimed); `raising` whether it is heading up.
 * Exact at both ends: at rest the gun sits on the hip or dead on the sights.
 */
export function quickScope(weapon: WeaponId, progress: number, raising: boolean, optic?: OpticId): QuickScope {
  const p = Math.min(1, Math.max(0, progress));
  const arc = Math.sin(Math.PI * p);
  const cant = CANT[weapon];
  if (optic === "red-dot") {
    const k = RED_DOT_SWING;
    if (raising) {
      // Cubic ease out, done early: on the sights by RED_DOT_ARRIVE of the raise.
      const q = Math.min(1, p / RED_DOT_ARRIVE);
      const up = Math.sin(Math.PI * q);
      return { lift: 1 - (1 - q) ** 3, roll: cant * k * up, yaw: -0.06 * k * up, dip: 0.025 * k * up };
    }
    return { lift: p * p * (3 - 2 * p), roll: -cant * 0.45 * k * arc, yaw: 0.04 * k * arc, dip: 0.035 * k * arc };
  }
  if (raising) {
    // Back-ease out: fast off the hip, a touch past the sights, settling onto them.
    const q = p - 1;
    const lift = 1 + (SNAP + 1) * q * q * q + SNAP * q * q;
    // The roll leads the lift, so the gun is already turning back level as it arrives.
    const lead = Math.sin(Math.PI * Math.min(1, p * 1.25));
    return { lift, roll: cant * lead, yaw: -0.06 * arc, dip: 0.025 * arc };
  }
  // Lowering: ease in to the hip, canting the other way.
  return { lift: p * p * (3 - 2 * p), roll: -cant * 0.45 * arc, yaw: 0.04 * arc, dip: 0.035 * arc };
}
