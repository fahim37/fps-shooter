"use client";

import { useEffect, useState, type PointerEvent, type MouseEvent } from "react";
import { useHud } from "./core/hud";
import { enterMobileFullscreen, exitMobileFullscreen, fullscreenElement } from "./mobileFullscreen";
import styles from "./MobileControls.module.css";

function command(action: () => void) {
  return {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.stopPropagation(); action(); },
    onClick: (e: MouseEvent<HTMLButtonElement>) => { if (e.detail === 0) action(); },
  };
}

export function FullscreenButton({ setMessage }: { setMessage: (message: string) => void }) {
  const [fullscreen, setFullscreen] = useState(() => !!fullscreenElement());
  useEffect(() => {
    const change = () => { setFullscreen(!!fullscreenElement()); if (!fullscreenElement()) screen.orientation?.unlock?.(); };
    document.addEventListener("fullscreenchange", change);
    document.addEventListener("webkitfullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      document.removeEventListener("webkitfullscreenchange", change);
    };
  }, []);

  return <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} data-fullscreen-control="" {...command(() => { if (fullscreen) { setMessage(""); void exitMobileFullscreen(); } else void enterMobileFullscreen(document.querySelector<HTMLElement>(".game-view")!).then(setMessage); })}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>;
}

export function MobileScreen({ message, setMessage, onLeave }: { message: string; setMessage: (message: string) => void; onLeave: () => void }) {
  const editing = useHud((s) => s.customizingControls);
  const portrait = useHud((s) => s.mobilePortrait && s.conn === "connected");
  const available = useHud((s) => s.ready && !s.menu && s.conn === "connected" && s.phase !== "ended");
  const alive = useHud((s) => s.alive);
  return <>
    {portrait && <div className={styles.rotateShade} role="dialog" aria-modal="true" aria-label="Landscape required">
      <div className={styles.rotateCard}>
        <svg viewBox="0 0 96 80" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="28" y="24" width="48" height="29" rx="5" /><path d="M66 16A29 29 0 0 0 17 42 M17 29v13h13 M33 63A29 29 0 0 0 82 37 M82 50V37H69" /><path d="M69 34v9" /></svg>
        <span className="eyebrow">LANDSCAPE PLAY</span>
        <h2>Rotate your phone to play</h2>
        <p>Turn your phone sideways for a full view and comfortable controls.</p>
        <button type="button" className="primary-button" {...command(() => void enterMobileFullscreen(document.querySelector<HTMLElement>(".game-view")!).then(setMessage))}>PLAY IN LANDSCAPE <span>↗</span></button>
        {message && <p className={styles.rotateMessage} role="status">{message}</p>}
        <small>If the screen stays vertical, turn on auto-rotate and rotate your phone.</small>
        <button type="button" className="outline-button" {...command(onLeave)}>RETURN TO LOBBY</button>
      </div>
    </div>}
    {!editing && available && !portrait && !alive && <div className={styles.screenTools}><FullscreenButton setMessage={setMessage} /></div>}
    {message && !portrait && <div className={styles.screenMessage} role="status">{message}<button type="button" aria-label="Dismiss screen message" onClick={() => setMessage("")}>×</button></div>}
  </>;
}
