import { memo } from "react";
import { useHud } from "./core/hud";
import { bearingYaw, relativeBearing, threatStrength } from "./core/minimap";
import styles from "./DamageIndicator.module.css";

/** A grenade icon circling the crosshair toward a live grenade close enough to hurt you. */
export const GrenadeWarning = memo(function GrenadeWarning({ angle }: { angle: number | null }) {
  if (angle === null) return null;
  return <div className={styles.grenade} style={{ transform: `rotate(${angle}deg)` }} role="status" aria-label="Grenade nearby">
    <svg viewBox="0 0 24 24" className={styles.grenadeIcon} style={{ transform: `rotate(${-angle}deg)` }}>
      <path d="M8 5h8v4 M10 3h6l3 4 M8 10a7 7 0 1 0 8 0z M12 11v9 M6 15h12" />
    </svg>
    <i className={styles.grenadeArrow} />
  </div>;
});

/** Red arcs around the crosshair pointing at whoever is hitting you; they turn as you turn. */
export const DamageIndicator = memo(function DamageIndicator({ now }: { now: number }) {
  const threats = useHud((s) => s.threats);
  const self = useHud((s) => s.mapPlayers.find((player) => player.relation === "self"));
  if (!self || !threats.length) return null;
  return <div className={styles.layer} aria-hidden="true">
    {threats.map((threat) => {
      const strength = threatStrength(threat, now);
      if (strength <= 0) return null;
      const angle = relativeBearing(self.yaw, bearingYaw(threat.from[0] - self.x, threat.from[2] - self.z)) * 180 / Math.PI;
      const wide = threat.kind === "explosion";
      return <svg key={threat.key} viewBox="-150 -150 300 300" className={styles.indicator} style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)`, opacity: strength }}>
        <path key={threat.at} className={styles.arc} d={wide ? "M-49.5-107.1A118 118 0 0 1 49.5-107.1" : "M-30.5-114A118 118 0 0 1 30.5-114"} />
        <path className={styles.tip} d="M-8-126 0-135 8-126" />
      </svg>;
    })}
  </div>;
});
