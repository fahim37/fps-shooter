"use client";

import type { CSSProperties } from "react";
import { MAPS } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";
import styles from "./LoadingScreen.module.css";

type Status = "loading" | "waiting" | "reconnecting" | "failed";

const STEPS = ["Terrain & collision", "Rigs & weapons", "Server sync"] as const;

/**
 * Match boot / reconnect / failure screen. Real progress only moves in three jumps (world, models,
 * server), so each stage eases the bar toward the next stage's mark over several seconds: it keeps
 * moving without ever claiming a step that has not finished. Everything animates in CSS.
 */
export function LoadingScreen({ map, code, loading, ready, conn, error, onLeave }: {
  map: MapId; code: string; loading: number; ready: boolean; conn: string; error: string; onLeave: () => void;
}) {
  const failed = conn === "error" || conn === "left";
  const status: Status = failed ? "failed" : conn === "reconnecting" ? "reconnecting" : !ready ? "loading" : "waiting";
  const step = ready ? 2 : loading >= 0.35 ? 1 : 0;
  // Where the bar is heading in this stage; the long ease-out makes it crawl, not sit.
  const target = status === "failed" ? Math.max(loading, 0.05) : status === "reconnecting" ? 0.5 : [0.32, 0.9, 0.97][step];
  const info = MAPS[map];
  const title = status === "failed" ? "Connection lost" : status === "reconnecting" ? "Reconnecting" : info.name;
  const line = status === "failed" ? error || "The game server stopped responding." : status === "reconnecting" ? "Hold position. Re-establishing the link to the game server." : info.tagline;
  return <div className={styles.screen} data-status={status} role={status === "failed" ? "alertdialog" : "status"} aria-live="polite" aria-label={status === "loading" ? `Loading ${info.name}` : title}>
    <div className={styles.floor} aria-hidden="true"><i /></div>
    <div className={styles.scan} aria-hidden="true" />
    <span className={styles.corner} data-c="tl" aria-hidden="true" /><span className={styles.corner} data-c="tr" aria-hidden="true" />
    <span className={styles.corner} data-c="bl" aria-hidden="true" /><span className={styles.corner} data-c="br" aria-hidden="true" />

    <div className={styles.stage}>
      <div className={styles.radar} aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="96" className={styles.ringOuter} />
          <circle cx="100" cy="100" r="70" />
          <circle cx="100" cy="100" r="44" />
          <circle cx="100" cy="100" r="18" />
          <path d="M100 4v192M4 100h192" />
          <g className={styles.ticks}>{Array.from({ length: 36 }, (_, i) => <path key={i} d="M100 4v6" transform={`rotate(${i * 10} 100 100)`} />)}</g>
        </svg>
        <span className={styles.sweep} />
        <b style={{ "--x": "64%", "--y": "28%", "--d": "0s" } as CSSProperties} />
        <b style={{ "--x": "30%", "--y": "62%", "--d": "-1.4s" } as CSSProperties} />
        <b style={{ "--x": "72%", "--y": "70%", "--d": "-2.3s" } as CSSProperties} />
        <em className={styles.core} />
      </div>

      <div className={styles.copy}>
        <span className={styles.eyebrow}><i />STRIKELINE / {code} · {status === "failed" ? "LINK DOWN" : status === "reconnecting" ? "SIGNAL LOST" : status === "waiting" ? "SYNCING" : "DEPLOYING"}</span>
        <h2 className={styles.title} key={title} aria-label={title}>
          {[...title].map((ch, i) => <span key={i} style={{ "--i": i } as CSSProperties} aria-hidden="true">{ch === " " ? " " : ch}</span>)}
        </h2>
        <p className={styles.line}>{line}</p>
        {status !== "failed" && status !== "reconnecting" && <p className={styles.chips}>{info.style.split(" · ").map((s) => <span key={s}>{s}</span>)}</p>}

        <div className={styles.progress} style={{ "--p": target } as CSSProperties} data-step={step}>
          <div className={styles.barHead}>
            <span>{status === "failed" ? "ABORTED" : status === "reconnecting" ? "RECONNECTING" : STEPS[step].toUpperCase()}</span>
            <output className={styles.pct} />
          </div>
          <div className={styles.bar}><span className={styles.fill} /><span className={styles.glint} /></div>
          {status !== "reconnecting" && <ol className={styles.steps}>
            {STEPS.map((s, i) => <li key={s} data-state={status === "failed" && i >= step ? "fail" : i < step ? "done" : i === step ? "active" : "pending"}><i aria-hidden="true" />{s}</li>)}
          </ol>}
        </div>

        <button type="button" className={styles.leave} onClick={onLeave}>{status === "failed" ? "Back to lobby" : "Return to lobby"}</button>
      </div>
    </div>
    {info.credit && status === "loading" && <small className={styles.credit}>{info.credit}</small>}
  </div>;
}
