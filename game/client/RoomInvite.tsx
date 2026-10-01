"use client";
import { useState } from "react";
import { inviteUrl } from "./net/invite";
export function RoomInvite({ code }: { code: string }) {
  const [message, setMessage] = useState("");
  const url = inviteUrl(code, window.location.href);
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${label} copied. Send it to your friends.`); }
    catch { setMessage("Select and copy the invite link below."); }
  }
  return <div className="room-invite">
    <div><span>INVITE FRIENDS</span><strong>{code}</strong></div>
    <div className="invite-actions"><button aria-label="Copy invite link" onClick={() => void copy(url, "Invite link")}>COPY INVITE LINK ↗</button><button aria-label="Copy room code" onClick={() => void copy(code, "Room code")}>COPY CODE</button></div>
    <input aria-label="Invite link" value={url} readOnly onFocus={(e) => e.target.select()} />
    {message && <small role="status">{message}</small>}
  </div>;
}
