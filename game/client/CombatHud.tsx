import type { HudState, KillFeedEntry } from "./core/hud";
import { WEAPONS, type WeaponId } from "../shared/weapons";
import styles from "./CombatHud.module.css";

export function weaponLabel(weapon: string) {
  return weapon === "grenade" ? "Frag grenade" : weapon === "fall" ? "Fall damage" : WEAPONS[weapon as WeaponId]?.name ?? weapon;
}

function WeaponIcon({ weapon }: { weapon: string }) {
  return <svg viewBox="0 0 64 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    {weapon === "grenade" ? <><path d="m29 5 6-3 4 5-5 3M29 9c-12 3-9 15 0 14 12-1 11-10 5-14Z" /><path d="m36 3 8 5 2 7" /></> : weapon === "fall" ? <><path d="M32 2v13m-6-6 6 6 6-6M16 21h32" /></> : weapon === "pistol" ? <path d="M13 6h36v7H30l-4 9H16l4-12h-7ZM38 6V3" /> : <><path d="m3 10 13-3h33v5H28l-3 8h-7l2-9-16 5ZM49 9h12M33 12l5 9h7l-5-9" />{weapon === "sniper" && <path d="M27 7V3h15v4M54 9v8" />}{weapon === "shotgun" && <path d="M35 14h18" />}</>}
  </svg>;
}

function nameColor(team: number, you: boolean, h: HudState) {
  return you ? styles.you : h.mode === "tdm" && team === h.myTeam ? styles.friendly : styles.enemy;
}

export function KillFeed({ h, now }: { h: HudState; now: number }) {
  const entries = h.killfeed.filter((k) => now - k.at < 7000).slice().reverse();
  return <div className={styles.feed} role="log" aria-label="Kill feed" aria-live="polite" aria-relevant="additions">
    {entries.map((k: KillFeedEntry) => <div key={k.key} className={`${styles.entry} ${k.localDeath ? styles.death : k.localKill ? styles.kill : ""} ${now - k.at > 6000 ? styles.fading : ""}`}>
      <b className={nameColor(k.killerTeam, k.localKill, h)} title={k.killer}>{k.localKill ? "YOU" : k.killer}</b>
      <span className={styles.weapon} title={weaponLabel(k.weapon)}><WeaponIcon weapon={k.weapon} /><span>{weaponLabel(k.weapon)}</span></span>
      {k.headshot && <span className={styles.headshot} title="Headshot" aria-label="Headshot">⌖</span>}
      <b className={nameColor(k.victimTeam, k.localDeath, h)} title={k.victim}>{k.localDeath ? "YOU" : k.victim}</b>
    </div>)}
  </div>;
}

export function DeathRecap({ h, now }: { h: HudState; now: number }) {
  const killer = h.killedBy;
  if (!killer) return null;
  const remaining = Math.max(0, h.respawnAt - now - h.serverOffset);
  const duration = Math.max(1, h.respawnAt - killer.at - h.serverOffset);
  const cameraLabel = !killer.id ? "DEATH REPORT" : h.deathCam === "killer" ? "LIVE KILLER CAM" : "LAST KNOWN POSITION";
  return <>
    <div className={styles.cameraLabel}><i />{cameraLabel}<span>{!killer.id ? "ENVIRONMENT" : "ATTACKER LOCATED"}</span></div>
    {killer.id && h.killerMarker && <div className={styles.marker} style={{ left: `${h.killerMarker.x}%`, top: `${h.killerMarker.y}%` }}><span>KILLER</span><b>{killer.name}</b><i /></div>}
    <section className={styles.recap} aria-label="Death recap">
      <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{killer.id ? killer.name.slice(0, 2).toUpperCase() : "↓"}</span><div><small>{killer.id ? "ELIMINATED BY" : "ELIMINATED"}</small><h2>{killer.name}</h2><p>{killer.id ? "Know your opponent. Plan your next move." : "Watch your footing and grenade fuse."}</p></div>{killer.streak >= 3 && killer.id && <span className={styles.streak}>{killer.streak} KILL STREAK</span>}</div>
      <div className={styles.details}>
        <div className={styles.cause}><WeaponIcon weapon={killer.weapon} /><span><small>LETHAL HIT</small><strong>{weaponLabel(killer.weapon)}</strong></span></div>
        <div><small>HIT TYPE</small><strong className={killer.headshot ? styles.enemy : ""}>{killer.headshot ? "⌖ Headshot" : killer.weapon === "fall" ? "Impact" : killer.weapon === "grenade" ? "Explosion" : "Body / limb"}</strong></div>
        {killer.distance !== null && <div><small>DISTANCE</small><strong>{Math.round(killer.distance)}<em> m</em></strong></div>}
        {killer.hp !== null && <div><small>KILLER HEALTH AT KILL</small><strong>{killer.hp}<em> / 100</em></strong><span className={styles.health}><i style={{ width: `${killer.hp}%` }} /></span></div>}
      </div>
      <div className={styles.respawn}><span>BACK IN THE FIGHT</span><strong>{(remaining / 1000).toFixed(1)}<small>s</small></strong><span>AUTOMATIC RESPAWN</span></div>
      <div className={styles.progress} role="progressbar" aria-label="Time until respawn" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remaining / duration * 100)}><i style={{ width: `${Math.min(100, remaining / duration * 100)}%` }} /></div>
    </section>
  </>;
}

export function EliminationNotice({ h, now }: { h: HudState; now: number }) {
  const kill = h.elimination;
  if (!kill || now - kill.at >= 2800) return null;
  return <div key={kill.at} className={`${styles.elimination} ${h.alive ? "" : styles.posthumous}`} role="status" aria-live="polite" aria-label={`You eliminated ${kill.name}`}>
    <span className={styles.eliminationIcon} aria-hidden="true">×</span>
    <div><small>YOU ELIMINATED</small><strong>{kill.name}</strong><p>{kill.headshot && <span>⌖ HEADSHOT · </span>}{weaponLabel(kill.weapon)}{kill.count > 1 && <b> · {kill.count} ELIMINATIONS</b>}{kill.streak >= 3 && <b> · {kill.streak} KILL STREAK</b>}</p></div>
  </div>;
}
