"use client";

import type { PointerEvent } from "react";
import type { Game } from "./core/game";
import { EMOTES } from "../shared/showcase";
import styles from "./EmoteMenu.module.css";

/** Emote picker (T): number keys with a keyboard, taps on touch. */
export function EmoteMenu({ game, touch }: { game: Game; touch: boolean }) {
  // Pointer-down, so a tap still works while another finger moves or aims.
  const tap = (code: string) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    game.input.press(code);
  };
  return <div className={styles.menu} role="menu" aria-label="Emotes">
    <span className={styles.title}>EMOTE<small>{touch ? "TAP ONE" : "PRESS 1–4 · T CLOSES"}</small></span>
    {EMOTES.map((emote, i) => <button type="button" role="menuitem" key={emote.id} onPointerDown={tap(`Emote${i + 1}`)}>
      <kbd>{i + 1}</kbd>{emote.label}
    </button>)}
    {touch && <button type="button" className={styles.close} onPointerDown={tap("EmoteMenu")}>CLOSE</button>}
  </div>;
}

/** While emoting: what it is and how to get back into the fight. */
export function EmoteHint({ emote }: { emote: string }) {
  const label = EMOTES.find((item) => item.id === emote)?.label ?? "Emote";
  return <div className={styles.hint} role="status">{label.toUpperCase()} · MOVE OR SHOOT TO STOP</div>;
}
