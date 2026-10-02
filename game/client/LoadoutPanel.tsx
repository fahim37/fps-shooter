"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { PRIMARIES, WEAPONS, type WeaponId } from "../shared/weapons";
import { COMPATIBLE_OPTICS, OPTICS, type OpticId } from "../shared/optics";
import { useLoadout } from "./loadout";
import { useHud } from "./core/hud";
import type { Game } from "./core/game";
import styles from "./LoadoutPanel.module.css";

const ROLES: Record<WeaponId, string> = {
  ar: "Balanced · Automatic", smg: "Close range · Automatic", shotgun: "Close range · Pump action",
  sniper: "Long range · Bolt action", pistol: "Backup · Semi automatic",
};

function GunIcon({ weapon }: { weapon: WeaponId }) {
  return <svg viewBox="0 0 120 40" aria-hidden="true" fill="currentColor">
    {weapon === "pistol" ? <path d="M30 10h55v10H57l-5 18H39l4-20H30z M77 7h5v5h-5z" />
      : <><path d="M8 14h24l8-5h39v4h29v5H79l-5 7H50l-6 12H33l5-15H22L8 29z" /><path d={weapon === "sniper" ? "M47 3h24v5H47z M97 18l8 19h-3l-8-19z" : weapon === "smg" ? "M56 23h9v15h-9z" : weapon === "shotgun" ? "M69 18h28v6H69z" : "M57 23h10l4 13-10 3z"} /></>}
  </svg>;
}

function OpticIcon({ optic }: { optic: OpticId }) {
  return <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
    {optic === "iron" ? <path d="M9 27V15h5v12h12V15h5v12 M20 20v7" /> : optic === "red-dot" ? <>
      <path d="M12 7H28L32 12L34 28H6L8 12Z M10 28L8 33H32L30 28 M6 33H34" />
      <circle cx="20" cy="19" r="1.5" fill="#ff6256" stroke="none" />
    </> : <>
      <circle cx="20" cy="20" r="14" /><circle cx="20" cy="20" r="2" fill="currentColor" />
      <path d="M20 6v9 M20 25v9 M6 20h9 M25 20h9" />
    </>}
  </svg>;
}

export const WeaponBar = memo(function WeaponBar({ game }: { game: Game }) {
  const h = useHud(useShallow((s) => ({ primary: s.primary, weapon: s.weapon, touch: s.touch })));
  const optic = useLoadout((s) => s.optics[h.weapon]);
  return <nav className={styles.bar} aria-label="Quick weapons">
    {[h.primary, "pistol" as const].map((weapon, i) => <button key={weapon} type="button" aria-label={`Equip ${WEAPONS[weapon].name}`} aria-pressed={h.weapon === weapon}
      onClick={() => game.input.press(i === 0 ? "Digit1" : "Digit2")}>
      <span className={styles.shortcut}>{i + 1}</span><GunIcon weapon={weapon} /><span>{WEAPONS[weapon].name}</span>
    </button>)}
    <button type="button" aria-label="Open loadout and scopes" onClick={() => game.openLoadout()}>
      <OpticIcon optic={optic} /><span>{OPTICS[optic].name}</span><small>{h.touch ? "GUNS / SCOPES" : "B · LOADOUT"}</small>
    </button>
  </nav>;
});

export const LoadoutPicker = memo(function LoadoutPicker({ game }: { game: Game }) {
  const h = useHud(useShallow((s) => ({ primary: s.primary, conn: s.conn, phase: s.phase, alive: s.alive, touch: s.touch })));
  const [inspecting, setInspecting] = useState<WeaponId>(h.primary);
  const { optics, equipOptic } = useLoadout();
  const disabled = h.conn !== "connected" || h.phase === "ended";
  return <div className={styles.picker}>
    <div className={styles.sectionLabel}>PRIMARY WEAPON <span>Tap to equip</span></div>
    <div className={styles.guns}>
      {PRIMARIES.map((weapon) => <button type="button" key={weapon} disabled={disabled} aria-label={`Choose ${WEAPONS[weapon].name}`} aria-pressed={h.primary === weapon}
        data-inspecting={inspecting === weapon} onClick={() => {
          setInspecting(weapon);
          if (h.primary !== weapon) game.send("loadout", { primary: weapon });
        }}>
        <span className={styles.equipped}>{h.primary === weapon ? "EQUIPPED" : "EQUIP"}</span>
        <GunIcon weapon={weapon} /><strong>{WEAPONS[weapon].name}</strong><small>{ROLES[weapon]}</small>
        <span className={styles.attachment}>{OPTICS[optics[weapon]].name}</span>
      </button>)}
    </div>
    <div className={styles.sectionLabel}>OPTIC FOR {WEAPONS[inspecting].name.toUpperCase()}<button type="button" aria-pressed={inspecting === "pistol"} onClick={() => setInspecting(inspecting === "pistol" ? h.primary : "pistol")}>{inspecting === "pistol" ? "Primary optics" : "Sidearm optics"}</button></div>
    <div className={styles.optics}>
      {COMPATIBLE_OPTICS[inspecting].map((optic) => <button type="button" key={optic} disabled={disabled} aria-label={`Attach ${OPTICS[optic].name} to ${WEAPONS[inspecting].name}`} aria-pressed={optics[inspecting] === optic} onClick={() => equipOptic(inspecting, optic)}>
        <OpticIcon optic={optic} /><strong>{OPTICS[optic].name}</strong><small>{OPTICS[optic].description}</small>
      </button>)}
    </div>
    <p className={styles.note} role="status">{h.alive ? "Guns equip immediately and keep their ammo." : "Your gun will be ready on respawn."} Optics save per gun.{!h.touch && " B for loadout · 1 / 2 or Q to switch."}</p>
  </div>;
});

export const LoadoutPanel = memo(function LoadoutPanel({ game }: { game: Game }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyB") { e.preventDefault(); game.resume(); }
      if (e.code === "Tab") {
        const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); previous?.focus(); };
  }, [game]);
  return <div className={styles.shade}>
    <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="loadout-heading">
      <header><div><span className="eyebrow">FIELD LOADOUT</span><h2 id="loadout-heading">Your gun. Your sights.</h2><p>Choose a gun, tap an optic, get back into the fight.</p></div><button type="button" aria-label="Close loadout" onClick={() => game.resume()}>×</button></header>
      <LoadoutPicker game={game} />
      <footer><small>Match stays live while you choose.</small><button type="button" onClick={() => game.resume()}>BACK TO MATCH <span>↗</span></button></footer>
    </div>
  </div>;
});
