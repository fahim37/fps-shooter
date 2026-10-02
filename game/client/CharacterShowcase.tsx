"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { SHOWOFFS, SHOWOFF_COOLDOWN_MS, type ShowcasePlayer, type ShowoffId } from "../shared/showcase";
import styles from "./CharacterShowcase.module.css";

const CharacterStage = dynamic(() => import("./CharacterStage"), { ssr: false, loading: () => <div className={styles.viewport}><p className={styles.notice}>Preparing the stage…</p></div> });

export function CharacterShowcase({ players, me, onShowoff, disabled = false, preview = false }: {
  players: ShowcasePlayer[]; me: string; onShowoff: (id: ShowoffId) => void; disabled?: boolean; preview?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [lastAt, setLastAt] = useState(0);
  // Two bodies per page on all screens keeps faces legible and mobile skinning inexpensive.
  const pages = Math.max(1, Math.ceil(players.length / 2));
  const current = Math.min(page, pages - 1);
  const visible = players.slice(current * 2, current * 2 + 2);
  const selected = players.find((p) => p.id === me)?.emote ?? "idle";
  return <section className={styles.showcase} aria-label={preview ? "Character preview" : "Lobby character stage"}>
    <div className={styles.heading}><span>{preview ? "MEET YOUR RANGER" : "THE LINEUP"}</span><button type="button" onClick={() => setHidden(!hidden)}>{hidden ? "Show preview" : "Hide preview"}</button></div>
    {!hidden && <>
      <CharacterStage players={visible} paused={paused} />
      <div className={styles.names}>{visible.map((p) => <div key={p.id}><strong>{p.name}{!preview && p.id === me ? " · You" : ""}</strong><span>{p.char === 1 ? "Female Ranger" : "Male Ranger"} · {SHOWOFFS.find((e) => e.id === p.emote)?.label ?? "At ease"}</span></div>)}</div>
      <div className={styles.stageTools}><button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? "Resume motion" : "Pause motion"}</button>{pages > 1 && <div><button type="button" aria-label="Previous players" disabled={current === 0} onClick={() => setPage(current - 1)}>←</button><span>{current + 1} / {pages}</span><button type="button" aria-label="Next players" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>→</button></div>}</div>
    </>}
    <div className={styles.showoffs} role="group" aria-label="Showoff animations">{SHOWOFFS.map((emote) => <button type="button" key={emote.id} disabled={disabled} aria-pressed={selected === emote.id} onClick={() => {
      const now = Date.now();
      if (now - lastAt < SHOWOFF_COOLDOWN_MS) return;
      setLastAt(now); onShowoff(emote.id);
    }}>{emote.label}</button>)}</div>
    <p className={styles.help}>{preview ? "Choose your character and try a move before you join." : "Your showoff is visible to everyone in the room."}</p>
  </section>;
}
