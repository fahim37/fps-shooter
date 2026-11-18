"use client";
import { useEffect, useRef, useState } from "react";
import { MAPS, mapId } from "../shared/map/maps";
import { roomInfo, type PublicRoom } from "./net/session";
import dialog from "./HowToPlay.module.css";
import styles from "./TeamPrompt.module.css";

/** Opening an invite to a Team DM room: pick a side before joining, whether the match is waiting or already on. */
export function TeamPrompt({ room: initial, onPick, onCancel }: { room: PublicRoom; onPick: (team: 0 | 1 | 2) => void; onCancel: () => void }) {
  const [room, setRoom] = useState(initial);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.code === "Escape") onCancel(); };
    window.addEventListener("keydown", key);
    // Keep the head counts current while the player decides.
    const timer = setInterval(async () => { const next = await roomInfo(initial.code); if (next) setRoom(next); }, 3000);
    return () => { window.removeEventListener("keydown", key); clearInterval(timer); };
  }, [initial.code, onCancel]);

  const cap = Math.ceil(room.max / 2);
  const live = room.phase !== "waiting";
  const sides = [{ team: 1 as const, name: "Blue", count: room.blue ?? 0 }, { team: 2 as const, name: "Red", count: room.red ?? 0 }];
  const enabled = sides.filter((s) => s.count < cap);
  return <div className={dialog.shade} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
    <section className={`${dialog.panel} ${styles.panel}`} role="dialog" aria-modal="true" aria-labelledby="team-prompt-title">
      <header className={dialog.header}>
        <div><span className={dialog.eyebrow}>{live ? "MATCH IN PROGRESS" : "ROOM LOBBY"} · {room.code}</span><h2 id="team-prompt-title">Choose your team</h2></div>
        <button type="button" className={dialog.close} onClick={onCancel} aria-label="Cancel">✕</button>
      </header>
      <p className={styles.room}>{room.name} · {MAPS[mapId(room.map)].name} · Team Deathmatch</p>
      <div className={styles.sides}>
        {sides.map((s) => {
          const full = s.count >= cap;
          return <button key={s.team} ref={s.team === enabled[0]?.team ? first : undefined} type="button" disabled={full}
            className={`${styles.side} ${s.team === 1 ? styles.blue : styles.red}`} aria-label={`Join ${s.name} team`} onClick={() => onPick(s.team)}>
            <strong>{s.name}</strong>
            <span>{full ? "Team full" : `${s.count} / ${cap} players`}</span>
          </button>;
        })}
      </div>
      <div className={styles.footer}>
        <button type="button" className="text-button" disabled={!enabled.length} onClick={() => onPick(0)}>Auto assign</button>
        {live && <small>You drop into the match on your team&apos;s side.</small>}
      </div>
    </section>
  </div>;
}
