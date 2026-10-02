"use client";

import { useEffect } from "react";
import { useHud } from "./core/hud";
import { QUALITY_ORDER, useSettings, type Quality } from "./settings";
import styles from "./GraphicsControl.module.css";

function cycleQuality() {
  const settings = useSettings.getState();
  const index = QUALITY_ORDER.indexOf(settings.quality);
  settings.set({ quality: QUALITY_ORDER[(index + 1) % QUALITY_ORDER.length] });
}

/** F6 is available during pointer lock, when clicking a normal select is impossible. */
export function GraphicsControl() {
  const quality = useSettings((s) => s.quality);
  const adaptive = useSettings((s) => s.adaptiveResolution);
  const ready = useHud((s) => s.ready);
  const locked = useHud((s) => s.locked);
  const touch = useHud((s) => s.touch);
  const menu = useHud((s) => s.menu);
  const loadoutOpen = useHud((s) => s.loadoutOpen);
  const customizing = useHud((s) => s.customizingControls);
  const scoreboard = useHud((s) => s.scoreboard || s.phase === "ended");

  useEffect(() => {
    const changeQuality = (e: KeyboardEvent) => {
      if (e.code !== "F6" || e.repeat || !useHud.getState().ready) return;
      e.preventDefault();
      cycleQuality();
    };
    window.addEventListener("keydown", changeQuality);
    return () => window.removeEventListener("keydown", changeQuality);
  }, []);

  if (!ready || scoreboard || customizing || loadoutOpen || (touch && menu)) return null;
  if (touch && !menu) return <div className={`${styles.control} ${styles.touchControl}`}>
    <button type="button" aria-label="Change graphics quality" title={`Graphics: ${quality}`} onClick={cycleQuality}><small>GRAPHICS</small><span>{quality.toUpperCase()} <span aria-hidden="true">↻</span></span></button>
  </div>;
  return <div className={`${styles.control} ${locked ? styles.compact : ""}`} aria-label="Live graphics settings">
    <label htmlFor="match-graphics-quality">GRAPHICS <kbd>F6</kbd></label>
    <select id="match-graphics-quality" aria-label="In-match graphics quality" value={quality} onChange={(e) => useSettings.getState().set({ quality: e.target.value as Quality })}>
      {QUALITY_ORDER.map((q) => <option key={q} value={q}>{q === "low" ? "Low / performance" : q[0].toUpperCase() + q.slice(1)}</option>)}
    </select>
    <label className={styles.adaptive}><input type="checkbox" checked={adaptive} onChange={(e) => useSettings.getState().set({ adaptiveResolution: e.target.checked })} />Adaptive resolution</label>
    <span className={styles.status} role="status" aria-live="polite">{quality.toUpperCase()} · {locked ? "F6 TO CHANGE" : "CHANGES APPLY LIVE"}</span>
  </div>;
}
