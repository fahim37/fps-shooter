/** Marked enemies (Z): who is marked, and where each mark sits on screen this frame. */
export interface Spot {
  id: string;
  /** performance.now() when the mark landed, and when it runs out. */
  at: number;
  until: number;
  /** You marked them, not a teammate. */
  mine: boolean;
}

export interface LiveSpot {
  /** Screen position, % of the view. */
  x: number;
  y: number;
  /** Metres to the enemy. */
  distance: number;
  /** Out of view: the mark sits on the screen's edge, turned `angle` (deg, clockwise from up) toward them. */
  edge: boolean;
  angle: number;
}

/** Written every frame by the game so marks follow their enemies smoothly; the HUD re-renders far less often. */
export const liveSpots = new Map<string, LiveSpot>();

const EDGE_X = 0.9, EDGE_Y = 0.82;

/**
 * Where a mark goes on screen from its projected position (x, y in -1..1, y up) and whether the
 * enemy is behind the camera: in view it sits on them, otherwise on the edge of the screen in
 * their direction.
 */
export function screenSpot(nx: number, ny: number, behind: boolean) {
  // Behind the camera the projection is mirrored through the centre.
  if (behind) { nx = -nx; ny = -ny; }
  const over = Math.max(Math.abs(nx) / EDGE_X, Math.abs(ny) / EDGE_Y);
  const edge = behind || over > 1;
  if (edge) {
    const k = over > 1e-6 ? 1 / over : 0;
    nx = k ? nx * k : 0; ny = k ? ny * k : -EDGE_Y;
  }
  return { x: (nx + 1) * 50, y: (1 - ny) * 50, edge, angle: edge ? Math.atan2(nx, ny) * 180 / Math.PI : 0 };
}
