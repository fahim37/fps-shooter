"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ROOM_SIZES, SCORE_LIMITS, matchMinutes, type GameMode } from "../shared/constants";
import type { ManagePlayerMsg, RoomSettingsMsg } from "../shared/messages";
import { NAME_MAX } from "../shared/names";
import styles from "./RoomControls.module.css";

function LobbyDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="room-control-title"
    onCancel={(e) => { e.preventDefault(); onClose(); }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={styles.panel}>
      <header><h2 id="room-control-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close room controls">×</button></header>
      {children}
    </section>
  </dialog>;
}

export function PlayerControls({ player, self, host, teamMode, canMove, swapCandidates, onManage, onRename, onClose }: {
  player: { id: string; name: string; team: number; connected: boolean };
  self: boolean; host: boolean; teamMode: boolean; canMove: boolean;
  swapCandidates: { id: string; name: string }[];
  onManage: (message: ManagePlayerMsg) => void; onRename: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(player.name);
  const [confirm, setConfirm] = useState<"kick" | "host" | null>(null);
  const [swapWith, setSwapWith] = useState("");
  const otherTeam = player.team === 1 ? 2 : 1;
  function manage(action: "kick" | "host") { onManage({ action, playerId: player.id }); onClose(); }
  return <LobbyDialog title={self ? "Your player" : player.name} onClose={onClose}>
    {self && <form onSubmit={(e) => { e.preventDefault(); onRename(name); onClose(); }}>
      <label className={styles.field}>Your name<input autoFocus value={name} maxLength={NAME_MAX} autoComplete="nickname" required onChange={(e) => setName(e.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={!name.trim() || name === player.name}>Save name</button>
    </form>}
    {host && <div className={styles.actions}>
      {teamMode && <><button type="button" className="outline-button" disabled={!canMove || !player.connected} onClick={() => { onManage({ action: "team", playerId: player.id, team: otherTeam }); onClose(); }}>Move to {otherTeam === 1 ? "Blue" : "Red"} team</button>
        {!canMove && <>
          <p>The other team is full. Swap players to keep both teams within capacity.</p>
          <label className={styles.field}>Swap with<select aria-label="Swap with" value={swapWith} onChange={(e) => setSwapWith(e.target.value)}><option value="">Choose a player</option>{swapCandidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button type="button" className="outline-button" disabled={!player.connected || !swapCandidates.some((p) => p.id === swapWith)} onClick={() => { onManage({ action: "team", playerId: player.id, team: otherTeam, swapWith }); onClose(); }}>Swap teams</button>
        </>}</>}
      {!self && <>
        <button type="button" className="outline-button" disabled={!player.connected} onClick={() => setConfirm("host")}>Make room host</button>
        <button type="button" className={`outline-button ${styles.danger}`} disabled={!player.connected} onClick={() => setConfirm("kick")}>Kick player</button>
      </>}
      {!player.connected && <p>Wait for this player to reconnect.</p>}
    </div>}
    {confirm && <div className={styles.confirm} role="group" aria-label="Confirm player action">
      <p>{confirm === "host" ? `Give ${player.name} control of this room? You will become a regular player.` : `Remove ${player.name} from this room?`}</p>
      <div><button type="button" className="outline-button" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="primary-button" disabled={!player.connected} onClick={() => manage(confirm)}>{confirm === "host" ? "Transfer host" : "Confirm kick"}</button></div>
    </div>}
  </LobbyDialog>;
}

export function RoomSettingsDialog({ settings, mode, fixedSize, minimumSize, onSave, onClose }: {
  settings: RoomSettingsMsg; mode: GameMode; fixedSize: boolean; minimumSize: number;
  onSave: (settings: RoomSettingsMsg) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  return <LobbyDialog title="Room settings" onClose={onClose}>
    <form onSubmit={(e) => { e.preventDefault(); onSave(draft); onClose(); }}>
      <label className={styles.field}>Room name<input autoFocus value={draft.roomName} maxLength={32} required onChange={(e) => setDraft({ ...draft, roomName: e.target.value })} /></label>
      <label className={styles.field}>Room size<select aria-label="Room size" value={draft.maxPlayers} disabled={fixedSize} onChange={(e) => setDraft({ ...draft, maxPlayers: Number(e.target.value) })}>
        {ROOM_SIZES.map((n) => <option key={n} value={n} disabled={n < minimumSize}>{n} players{mode === "tdm" ? ` · ${n / 2}v${n / 2}` : ""}</option>)}
      </select></label>
      <p>{fixedSize ? "Duel and Doubles have fixed team sizes." : "Move or remove players to make room for a smaller size."}</p>
      <label className={styles.field}>Score to win<select aria-label="Score to win" value={draft.scoreLimit} onChange={(e) => setDraft({ ...draft, scoreLimit: Number(e.target.value) })}>
        {SCORE_LIMITS[mode].map((n) => <option key={n} value={n}>{n} points</option>)}
      </select></label>
      <p>Match time: {matchMinutes(mode, draft.scoreLimit)} minutes.</p>
      <label className={styles.check}><input type="checkbox" checked={draft.privateRoom} onChange={(e) => setDraft({ ...draft, privateRoom: e.target.checked })} />Private room</label>
      {!fixedSize && <label className={styles.check}><input type="checkbox" checked={draft.practiceBots} onChange={(e) => setDraft({ ...draft, practiceBots: e.target.checked })} />Practice bots fill empty slots</label>}
      <button type="submit" className="primary-button" disabled={!draft.roomName.trim()}>Save room settings</button>
    </form>
  </LobbyDialog>;
}
