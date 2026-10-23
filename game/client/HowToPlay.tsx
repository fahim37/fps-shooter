"use client";

import { useEffect } from "react";
import { MODE_INFO, SCORE_LIMITS } from "../shared/constants";
import styles from "./HowToPlay.module.css";

type Row = [keys: string[], action: string, note?: string];

const KEYBOARD: { title: string; rows: Row[] }[] = [
  { title: "MOVEMENT", rows: [
    [["WASD"], "Move"],
    [["Shift"], "Sprint", "Hold while moving forward"],
    [["Space"], "Jump"],
    [["Ctrl"], "Crouch", "Steadier aim, quieter steps"],
    [["Q", "E"], "Peek left / right", "Aims down sights while peeking"],
  ] },
  { title: "COMBAT", rows: [
    [["Left click"], "Fire"],
    [["Right click"], "Aim down sights"],
    [["R"], "Reload"],
    [["1", "2"], "Primary / sidearm", "Mouse wheel swaps too"],
    [["C"], "Grenade", "Press to pull the pin (the fuse starts), hold to aim along the arc, release to throw · it blows up in your hand if held too long · right mouse lobs"],
  ] },
  { title: "GAME", rows: [
    [["B"], "Loadout", "Weapon and sights for your next spawn"],
    [["V"], "First / third person"],
    [["T"], "Emote", "Then 1–4; move or shoot to stop"],
    [["Tab"], "Scoreboard", "Hold"],
    [["F6"], "Graphics quality"],
    [["H"], "How to play", "This guide"],
    [["Esc"], "Pause", "Invite friends, settings, leave"],
  ] },
  { title: "VOICE", rows: [
    [["N"], "Team voice", "Push-to-talk to your team. The first press turns voice on"],
    [["M"], "All voice", "Push-to-talk to everyone. Free for All uses All for both"],
    [["Mic button"], "Open mic on / off", "Under the scores: keeps your mic on for the selected Team or All channel"],
  ] },
];

const TOUCH: Row[] = [
  [["Left side"], "Move", "Drag anywhere on the left"],
  [["Right side"], "Aim", "Drag anywhere on the right"],
  [["Fire"], "Shoot"],
  [["Aim"], "Aim down sights"],
  [["Peek left", "Peek right"], "Peek", "Aims down sights while peeking"],
  [["Jump"], "Jump"],
  [["Crouch"], "Crouch", "Steadier aim, quieter steps"],
  [["Sprint"], "Sprint"],
  [["Reload"], "Reload"],
  [["Switch"], "Primary / sidearm"],
  [["Grenade"], "Grenade", "Hold to aim along the arc, release to throw · Aim to lob"],
  [["Camera"], "First / third person"],
  [["Emote"], "Emote", "Pick one; move or shoot to stop"],
  [["Pause"], "Pause", "Invite friends, settings, leave"],
  [["Team", "All"], "Voice chat", "Icons under the scores: hold to talk to your team or everyone"],
  [["Mic"], "Open mic on / off", "Keeps your mic on for the selected channel"],
  [["Layout"], "Move and resize buttons"],
];

const TIPS = [
  "Headshots hit much harder than body shots.",
  "Standing still or crouching tightens your spread; running and jumping widen it.",
  "Out of the fight for a few seconds, your health comes back on its own.",
  "Every elimination refills part of your reserve ammo.",
  "Damage an enemy that a teammate finishes within 10 seconds and you earn an assist.",
];

/** Controls and rules, from the lobby or in a match (H). */
export function HowToPlay({ onClose, touch = false, locked = false }: { onClose: () => void; touch?: boolean; locked?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.code === "Escape" && !locked) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, locked]);
  return <div className={styles.shade} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>FIELD MANUAL</span><h2 id="how-to-play-title">How to play</h2></div>
        {locked ? <span className={styles.closeHint}><kbd>H</kbd> to close</span> : <button type="button" className={styles.close} onClick={onClose} aria-label="Close how to play">✕</button>}
      </header>
      <div className={styles.goal}>
        <div><strong>Team Deathmatch</strong><p>Two teams. First to {MODE_INFO.tdm.scoreLimit} eliminations (the room creator can pick up to {SCORE_LIMITS.tdm.at(-1)}), or the most when the clock runs out, wins.</p></div>
        <div><strong>Free for All</strong><p>Everyone for themselves. First to {MODE_INFO.ffa.scoreLimit} eliminations (or the room&rsquo;s chosen target) wins.</p></div>
      </div>
      <div className={styles.columns}>
        {(touch ? [{ title: "TOUCH", rows: TOUCH }] : KEYBOARD).map((group) => <div key={group.title} className={styles.group}>
          <h3>{group.title}</h3>
          <dl>{group.rows.map(([keys, action, note]) => <div key={action} className={styles.row}>
            <dt>{keys.map((k, i) => <span key={k}>{i > 0 && <i>/</i>}<kbd>{k}</kbd></span>)}</dt>
            <dd>{action}{note && <small>{note}</small>}</dd>
          </div>)}</dl>
        </div>)}
        <div className={styles.group}>
          <h3>TIPS</h3>
          <ul className={styles.tips}>{TIPS.map((tip) => <li key={tip}>{tip}</li>)}</ul>
        </div>
      </div>
    </section>
  </div>;
}
