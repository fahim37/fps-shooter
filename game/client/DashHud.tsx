import { useEffect, useRef } from "react";
import { DASH_KILLS, DASH_MAX } from "../shared/constants";
import type { HudState } from "./core/hud";
import styles from "./DashHud.module.css";

/** How long the rush of streaks plays after a dash, and the flash when one is earned back. */
const RUSH_MS = 620;
const READY_MS = 900;
/** The streaks are drawn once at this size and stretched over the screen: they are soft, and blur well. */
const RUSH_W = 960, RUSH_H = 540, RUSH_RAYS = 84;
const RUSH_TINTS = [["233,251,255", 0.85], ["168,236,255", 0.6], ["255,255,255", 0.7]] as const;

/**
 * Thin rays fanning out from around the crosshair, clear in the middle, with a pale glow toward
 * the screen's edges. Drawn in a space where the edges are at ±1, so it stretches with the window.
 */
function drawRush(canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, RUSH_W, RUSH_H);
  g.setTransform(RUSH_W / 2, 0, 0, RUSH_H / 2, RUSH_W / 2, RUSH_H / 2);
  // The same rays every time.
  let seed = 7;
  const rand = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < RUSH_RAYS; i++) {
    const angle = (i + rand() * 0.8) / RUSH_RAYS * Math.PI * 2, half = 0.0016 + rand() * 0.004, from = 0.12 + rand() * 0.16;
    const [rgb, alpha] = RUSH_TINTS[i % RUSH_TINTS.length];
    const fade = g.createRadialGradient(0, 0, from, 0, 0, from + 0.4);
    fade.addColorStop(0, `rgba(${rgb},0)`);
    fade.addColorStop(1, `rgba(${rgb},${alpha})`);
    g.fillStyle = fade;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(angle - half) * 1.5, Math.sin(angle - half) * 1.5);
    g.lineTo(Math.cos(angle + half) * 1.5, Math.sin(angle + half) * 1.5);
    g.fill();
  }
  const glow = g.createRadialGradient(0, 0, 0.6, 0, 0, 1.42);
  glow.addColorStop(0, "rgba(159,233,255,0)");
  glow.addColorStop(0.6, "rgba(159,233,255,0.19)");
  glow.addColorStop(1, "rgba(223,248,255,0.44)");
  g.fillStyle = glow;
  g.fillRect(-1, -1, 2, 2);
}

/**
 * The dash (F): a chip by the weapon bar that glows while one is in hand, shows how many, and counts
 * kills toward the next refill, and the streaks that tear past the edges of the screen while dashing.
 *
 * The streaks are one small canvas, drawn once and hidden until a dash: the dash then only scales
 * and fades it, which the browser does off the game's thread with a single blended layer. (Masked
 * gradient layers larger than the screen, built at the moment of the dash, cost an office PC's
 * integrated graphics several dropped frames each time.)
 */
export function DashHud({ h, now, game }: { h: HudState; now: number; game: { input: { press(code: string): void } } | null }) {
  const ready = h.dash > 0;
  const rushing = h.dashAt > 0 && now - h.dashAt < RUSH_MS;
  const earned = ready && h.dashReadyAt > 0 && now - h.dashReadyAt < READY_MS;
  const rush = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (rush.current) drawRush(rush.current); }, []);
  useEffect(() => {
    const el = rush.current;
    // Only a dash made just now: the HUD also comes back (respawn, closing a menu) with an old one on record.
    if (!el || typeof el.animate !== "function" || performance.now() - h.dashAt > 250) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.style.visibility = "visible";
    const play = el.animate(still
      ? [{ opacity: 0 }, { opacity: 0.6, offset: 0.14 }, { opacity: 0 }]
      : [{ transform: "scale(1)", opacity: 0, easing: "cubic-bezier(.1, .7, .2, 1)" }, { opacity: 1, offset: 0.14 }, { opacity: 0.7, offset: 0.55 }, { transform: "scale(2.2)", opacity: 0 }],
    { duration: RUSH_MS });
    const hide = () => { el.style.visibility = ""; };
    play.onfinish = hide;
    return () => { play.cancel(); hide(); };
  }, [h.dashAt]);
  return <>
    <canvas ref={rush} className={styles.rush} width={RUSH_W} height={RUSH_H} aria-hidden="true" />
    <button type="button" className={styles.chip} data-ready={ready} data-earned={earned || undefined} data-used={rushing || undefined}
      aria-label={`Dashes: ${h.dash}${h.dash < DASH_MAX ? `, ${h.dashKills} of ${DASH_KILLS} kills to more` : ""}`} onPointerDown={() => game?.input.press("KeyF")}>
      <span className={styles.key}>{h.touch ? "TAP" : "F"}</span>
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 9h10l7 7-7 7H4l7-7z" /><path d="M18 9h4l7 7-7 7h-4l7-7z" className={styles.tail} /></svg>
      <b className={styles.count}>{h.dash}</b>
      {h.dash < DASH_MAX ? <span className={styles.pips}>{Array.from({ length: DASH_KILLS }, (_, i) => <i key={i} data-on={i < h.dashKills} />)}</span> : <small>DASH</small>}
    </button>
  </>;
}
