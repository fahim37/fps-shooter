"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { SHOWOFFS, SHOWOFF_COOLDOWN_MS, type ShowcasePlayer, type ShowoffId } from "../shared/showcase";
import type { TagMode } from "./CharacterStage";
import styles from "./CharacterShowcase.module.css";

const CharacterStage = dynamic(() => import("./CharacterStage"), { ssr: false, loading: () => <div className={styles.viewport}><p className={styles.notice}>Preparing the stage…</p></div> });

/** Blue stands on the left and Green on the right; Free for All keeps join order. */
const teamOrder = (team: number) => team === 1 ? 0 : team === 2 ? 1 : 2;

/** Fills its parent: the stage flexes, the showoff row stays fixed. Every player in the room is on stage together. */
export function CharacterShowcase({ players, me, onShowoff, disabled = false, preview = false }: {
  players: ShowcasePlayer[]; me: string; onShowoff: (id: ShowoffId) => void; disabled?: boolean; preview?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [lastAt, setLastAt] = useState(0);
  const lineup = [...players].sort((a, b) => teamOrder(a.team) - teamOrder(b.team));
  const selected = players.find((p) => p.id === me)?.emote ?? "idle";
  const label = (p: ShowcasePlayer, mode: TagMode) => <>
    <strong data-me={!preview && p.id === me ? "" : undefined} title={p.name}><span>{p.name}</span>{!preview && p.id === me && <em>{" · You"}</em>}</strong>
    {mode === "full" && <small>{p.char === 1 ? "Female Ranger" : "Male Ranger"} · {SHOWOFFS.find((e) => e.id === p.emote)?.label ?? "At ease"}</small>}
  </>;
  return <section className={styles.showcase} data-lineup-size={lineup.length} aria-label={preview ? "Character preview" : "Lobby character stage"}>
    {preview && <span className={styles.watermark} aria-hidden="true">{lineup[0]?.name}</span>}
    <div className={styles.heading}>
      <span>{preview ? "MEET YOUR RANGER" : "THE LINEUP"}</span>
      <div className={styles.tools}>
        {!hidden && <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? "Resume motion" : "Pause motion"}</button>}
        <button type="button" onClick={() => setHidden(!hidden)}>{hidden ? "Show preview" : "Hide preview"}</button>
      </div>
    </div>
    {hidden ? <div className={styles.viewport}><p className={styles.notice}>Preview hidden to save power.</p></div> : <CharacterStage players={lineup} paused={paused} label={label} />}
    <div className={styles.showoffs} role="group" aria-label="Showoff animations" title={preview ? "Try a move before you join." : "Your showoff is visible to everyone in the room."}>{SHOWOFFS.map((emote) => <button type="button" key={emote.id} disabled={disabled} aria-pressed={selected === emote.id} onClick={() => {
      const now = Date.now();
      if (now - lastAt < SHOWOFF_COOLDOWN_MS) return;
      setLastAt(now); onShowoff(emote.id);
    }}>{emote.label}</button>)}</div>
  </section>;
}
