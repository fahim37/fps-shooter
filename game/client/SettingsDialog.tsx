"use client";

import { useEffect, useRef } from "react";
import { SettingsPanel } from "./SettingsPanel";
import styles from "./HowToPlay.module.css";

/** Help and settings buttons for the pre-match top bars. */
export function LobbyTools({ onHelp, onSettings }: { onHelp: () => void; onSettings: () => void }) {
  return <>
    <button type="button" className="icon-button" aria-label="How to play" title="How to play · Controls" onClick={onHelp}>?</button>
    <button type="button" className="icon-button" aria-label="Settings" title="Settings" onClick={onSettings}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><circle cx="12" cy="12" r="6.6" /><path d="M12 2.6v2.8M12 18.6v2.8M21.4 12h-2.8M5.4 12H2.6M18.6 5.4l-2 2M7.4 16.6l-2 2M18.6 18.6l-2-2M7.4 7.4l-2-2" /></svg>
    </button>
  </>;
}

/** Settings as an overlay, so the screens behind it never need to grow or scroll. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.code === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose]);
  return <div className={styles.shade} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`${styles.panel} ${styles.narrow}`} role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>GAME SETTINGS</span><h2 id="settings-title">Settings</h2></div>
        <button ref={close} type="button" className={styles.close} onClick={onClose} aria-label="Close settings">✕</button>
      </header>
      <SettingsPanel />
      <p className="controls-help">WASD move · Mouse aim · Click fire · Right-click ADS · Shift sprint · Space jump · Ctrl crouch · Q / E peek · R reload · 1 / 2 or wheel switch · Hold C grenade · V camera · T emote · Tab scores · Esc pause</p>
    </section>
  </div>;
}
