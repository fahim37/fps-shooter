import { MAX_HEALTH, REGEN_DELAY_MS } from "../shared/constants";
import type { HudState } from "./core/hud";
import styles from "./HealthBar.module.css";

export function HealthBar({ h, now }: { h: HudState; now: number }) {
  const hp = Math.max(0, Math.min(MAX_HEALTH, Math.round(h.hp)));
  const delay = h.hurtAt > 0 ? Math.max(0, Math.ceil((REGEN_DELAY_MS - Math.max(0, now - h.hurtAt)) / 1000)) : 0;
  const status = hp === MAX_HEALTH ? "FULL HEALTH" : h.regenerating ? "REGENERATING" : delay > 0 ? `HEAL IN ${delay}s · TAKE COVER` : "TAKE COVER TO HEAL";
  return <div className={`${styles.panel} ${hp <= 30 ? styles.critical : hp <= 60 ? styles.wounded : ""} ${h.regenerating ? styles.healing : ""}`} data-health-state={h.regenerating ? "healing" : hp <= 30 ? "critical" : "normal"}>
    <div className={styles.heading}><span><b aria-hidden="true">+</b> HEALTH</span><strong>{hp}<small> / {MAX_HEALTH}</small></strong></div>
    <div className={styles.track} role="progressbar" aria-label="Health" aria-valuemin={0} aria-valuemax={MAX_HEALTH} aria-valuenow={hp} aria-valuetext={`${hp} of ${MAX_HEALTH}. ${status}`}><i style={{ width: `${hp}%` }} /></div>
    <span className={styles.status}>{h.regenerating && <b aria-hidden="true">+</b>} {status}</span>
  </div>;
}
