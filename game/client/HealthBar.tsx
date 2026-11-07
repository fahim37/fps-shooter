import { MAX_HEALTH, MAX_SHIELD, REGEN_DELAY_MS } from "../shared/constants";
import type { HudState } from "./core/hud";
import styles from "./HealthBar.module.css";

/** How long the status line announces a refilled shield. */
const SHIELD_NOTICE_MS = 2500;

export function HealthBar({ h, now }: { h: HudState; now: number }) {
  const hp = Math.max(0, Math.min(MAX_HEALTH, Math.round(h.hp)));
  const delay = h.hurtAt > 0 ? Math.max(0, Math.ceil((REGEN_DELAY_MS - Math.max(0, now - h.hurtAt)) / 1000)) : 0;
  const shield = Math.max(0, Math.min(MAX_SHIELD, Math.round(h.shield)));
  const restored = h.shieldAt > 0 && now - h.shieldAt < SHIELD_NOTICE_MS;
  const status = restored ? "SHIELD RESTORED" : hp === MAX_HEALTH ? "FULL HEALTH" : h.regenerating ? "REGENERATING" : delay > 0 ? `HEAL IN ${delay}s · TAKE COVER` : "TAKE COVER TO HEAL";
  return <div className={`${styles.panel} ${hp <= 30 ? styles.critical : hp <= 60 ? styles.wounded : ""} ${h.regenerating ? styles.healing : ""} ${restored ? styles.restored : ""}`} data-health-state={h.regenerating ? "healing" : hp <= 30 ? "critical" : "normal"}>
    <div className={styles.heading}><span><b aria-hidden="true">+</b> HEALTH</span><strong>{hp}{shield > 0 && <em aria-label={`plus ${shield} shield`}> +{shield}</em>}<small> / {MAX_HEALTH}</small></strong></div>
    <div className={styles.shield} role="progressbar" aria-label="Shield" aria-valuemin={0} aria-valuemax={MAX_SHIELD} aria-valuenow={shield}><i style={{ width: `${shield / MAX_SHIELD * 100}%` }} /></div>
    <div className={styles.track} role="progressbar" aria-label="Health" aria-valuemin={0} aria-valuemax={MAX_HEALTH} aria-valuenow={hp} aria-valuetext={`${hp} of ${MAX_HEALTH}. ${status}`}><i style={{ width: `${hp}%` }} /></div>
    <span className={styles.status}>{h.regenerating && <b aria-hidden="true">+</b>} {status}</span>
  </div>;
}
