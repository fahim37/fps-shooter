import { memo } from "react";
import { useHud } from "./core/hud";
import { bearingYaw, relativeBearing, threatStrength } from "./core/minimap";
import styles from "./DamageIndicator.module.css";

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
