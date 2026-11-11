import { memo, useEffect, useRef } from "react";
import { useHud } from "./core/hud";
import { liveSpots } from "./core/spots";
import styles from "./SpotLayer.module.css";

/**
 * Marks on enemies spotted with Z. Each one locks on with a short animation, follows its enemy
 * (through walls) with the distance over it, drains a ring as it runs out, and slides to the edge
 * of the screen with an arrow when the enemy is out of view.
 */
export const SpotLayer = memo(function SpotLayer() {
  const spots = useHud((state) => state.spots);
  const nodes = useRef(new Map<string, { root: HTMLDivElement; distance: HTMLSpanElement | null; shown: number }>());
  useEffect(() => {
    if (!spots.length) return;
    let frame = 0;
    // The HUD re-renders a few times a second; the marks are moved every frame from the game's live positions.
    const tick = () => {
      for (const [id, node] of nodes.current) {
        const live = liveSpots.get(id);
        if (!live) { node.root.style.visibility = "hidden"; continue; }
        node.root.style.visibility = "visible";
        node.root.style.left = `${live.x}%`;
        node.root.style.top = `${live.y}%`;
        node.root.toggleAttribute("data-edge", live.edge);
        node.root.style.setProperty("--angle", `${live.angle}deg`);
        const metres = Math.round(live.distance);
        if (node.distance && metres !== node.shown) { node.shown = metres; node.distance.textContent = `${metres} m`; }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spots.length]);
  return <>{spots.map((spot) => <div
    key={`${spot.id}:${spot.at}`} className={styles.spot} role="status" aria-label="Enemy marked"
    style={{ visibility: "hidden", ["--life" as string]: `${Math.round(spot.until - spot.at)}ms` }}
    ref={(root) => {
      if (root) nodes.current.set(spot.id, { root, distance: root.querySelector("span"), shown: -1 });
      else nodes.current.delete(spot.id);
    }}>
    <div className={styles.lock}>
      <svg viewBox="-24 -24 48 48" aria-hidden="true">
        <circle r="9" className={styles.ping} />
        <circle r="9" className={`${styles.ping} ${styles.late}`} />
        <circle r="13" pathLength="100" className={styles.timer} />
        <g className={styles.brackets}>
          <path d="M-17-10v-7h7 M10-17h7v7 M17 10v7h-7 M-10 17h-7v-7" />
        </g>
        <path d="M0-7.5 7.5 0 0 7.5-7.5 0Z" className={styles.diamond} />
        <path d="M0-3 3 0 0 3-3 0Z" className={styles.core} />
      </svg>
      <span className={styles.distance} />
      <i className={styles.arrow} />
    </div>
  </div>)}</>;
});

/** Shown to a player an enemy has marked: a warning under the match clock that drains as the mark runs out. */
export function MarkedWarning({ until, now }: { until: number; now: number }) {
  const left = Math.max(0, until - now);
  if (left <= 0) return null;
  return <div key={until} className={styles.marked} role="alert" style={{ ["--left" as string]: `${Math.round(left)}ms` }}>
    <svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M-10 0Q0-9 10 0 0 9-10 0Z" /><circle r="2.6" /></svg>
    <span><b>MARKED</b><small>AN ENEMY CAN SEE YOU · BREAK LINE OF SIGHT</small></span>
    <i />
  </div>;
}
