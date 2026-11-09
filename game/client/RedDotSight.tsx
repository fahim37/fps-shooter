import { memo } from "react";
import styles from "./RedDotSight.module.css";

/** Aim (eased ADS) at which the dot starts to show: the glass reaches the eye early in the raise (RED_DOT_UP). */
const DOT_FROM = 0.3;

/** The projected dot stays on aim; the physical housing lives on the gun. */
export const RedDotSight = memo(function RedDotSight({ enemy, ads }: { enemy: boolean; ads: number }) {
  return <div aria-label={enemy ? "Enemy in sights" : "Red dot sight"}
    className={`crosshair aiming red-dot-sight ${styles.sight} ${enemy ? styles.target : ""}`}
    style={{ opacity: Math.min(1, (ads - DOT_FROM) / 0.3) }}>
    <div className={styles.dot} aria-hidden="true" />
  </div>;
});
