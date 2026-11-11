import { DASH_KILLS, DASH_MAX } from "../shared/constants";
import type { HudState } from "./core/hud";
import styles from "./DashHud.module.css";

/** How long the rush of streaks plays after a dash, and the flash when one is earned back. */
const RUSH_MS = 620;
const READY_MS = 900;

/**
 * The dash (F): a chip by the weapon bar that glows while one is in hand, shows how many, and counts
 * kills toward the next refill, and the streaks that tear past the edges of the screen while dashing.
 */
export function DashHud({ h, now, game }: { h: HudState; now: number; game: { input: { press(code: string): void } } | null }) {
  const ready = h.dash > 0;
  const rushing = h.dashAt > 0 && now - h.dashAt < RUSH_MS;
  const earned = ready && h.dashReadyAt > 0 && now - h.dashReadyAt < READY_MS;
  return <>
    {rushing && <div key={h.dashAt} className={styles.rush} aria-hidden="true"><i /><b /><em /></div>}
    <button type="button" className={styles.chip} data-ready={ready} data-earned={earned || undefined} data-used={rushing || undefined}
      aria-label={`Dashes: ${h.dash}${h.dash < DASH_MAX ? `, ${h.dashKills} of ${DASH_KILLS} kills to more` : ""}`} onPointerDown={() => game?.input.press("KeyF")}>
      <span className={styles.key}>{h.touch ? "TAP" : "F"}</span>
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 9h10l7 7-7 7H4l7-7z" /><path d="M18 9h4l7 7-7 7h-4l7-7z" className={styles.tail} /></svg>
      <b className={styles.count}>{h.dash}</b>
      {h.dash < DASH_MAX ? <span className={styles.pips}>{Array.from({ length: DASH_KILLS }, (_, i) => <i key={i} data-on={i < h.dashKills} />)}</span> : <small>DASH</small>}
    </button>
  </>;
}
