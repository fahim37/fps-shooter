import { memo } from "react";
import styles from "./RedDotSight.module.css";

/** The projected dot stays on aim; the physical housing lives on the gun. */
export const RedDotSight = memo(function RedDotSight({ enemy, ads }: { enemy: boolean; ads: number }) {
  return <div aria-label={enemy ? "Enemy in sights" : "Red dot sight"}
    className={`crosshair aiming red-dot-sight ${styles.sight} ${enemy ? styles.target : ""}`}
    style={{ opacity: Math.min(1, (ads - 0.5) / 0.3) }}>
    <div className={styles.dot} aria-hidden="true" />
  </div>;
});
