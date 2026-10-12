import { memo, type CSSProperties } from "react";
import { MAX_HEALTH } from "../shared/constants";
import { useHud } from "./core/hud";
import { SQUAD_COLORS, type SquadMember } from "./core/squad";
import styles from "./SquadPanel.module.css";

function Member({ member }: { member: SquadMember }) {
  const hp = Math.max(0, Math.min(MAX_HEALTH, member.hp));
  const state = !member.connected ? "offline" : !member.alive ? "down" : hp <= 30 ? "critical" : hp <= 60 ? "wounded" : "healthy";
  const label = `${member.me ? "You" : member.name}${member.bot ? " (bot)" : ""}: ${state === "offline" ? "offline" : state === "down" ? "eliminated" : `${hp} health`}`;
  return <li className={styles.member} data-state={state} data-me={member.me || undefined} aria-label={label} style={{ "--slot": SQUAD_COLORS[member.slot] } as CSSProperties}>
    <span className={styles.slot} aria-hidden="true">{member.slot + 1}</span>
    <div className={styles.body}>
      <div className={styles.name}><b title={member.name}>{member.name}</b>{member.me && <small>YOU</small>}{member.bot && <small>BOT</small>}{state === "down" && <em>✕ DOWN</em>}{state === "offline" && <em>OFFLINE</em>}</div>
      <div className={styles.track} aria-hidden="true"><i className={styles.lag} style={{ width: `${hp}%` }} /><i className={styles.fill} style={{ width: `${hp}%` }} /></div>
    </div>
  </li>;
}

/** Your team's names and health on the left edge, PUBG-style. */
export const SquadPanel = memo(function SquadPanel() {
  const squad = useHud((s) => s.squad);
  const touch = useHud((s) => s.touch);
  if (squad.length < 2) return null;
  // Touch screens keep the left side free for the fire and peek buttons.
  return <ol className={`${styles.panel} ${touch ? styles.strip : ""}`} aria-label="Squad status">{squad.map((member) => <Member key={member.id} member={member} />)}</ol>;
});
