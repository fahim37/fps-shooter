"use client";

import type { LivePlayer, LiveRoom, LiveSnapshot, OverviewStats, Wire } from "@/game/shared/adminApi";
import s from "./admin.module.css";
import { Card, Kpi, Notice, Pill, Table, type Col } from "./ui";
import { Sparkline } from "./charts";
import { dayLabel, device, deviceIcon, duration, flag, kd, mapName, modeShort, num, place, teamName, dateTime } from "./format";

export function pingTone(ms: number) {
  return ms <= 0 ? "muted" : ms < 80 ? "good" : ms < 150 ? "warn" : "bad";
}

export function TeamPill({ team }: { team: number }) {
  if (team !== 1 && team !== 2) return <Pill tone="muted">FFA</Pill>;
  return <Pill tone={team === 1 ? "blue" : "red"}>{teamName(team)}</Pill>;
}

const phaseLabel: Record<string, string> = { waiting: "Lobby", warmup: "Warmup", live: "Live", ended: "Results" };

export function KpiRow({ live, overview }: { live: LiveSnapshot | null; overview: Wire<OverviewStats> | null }) {
  const activeMatches = live?.rooms.filter((r) => r.humans > 0 && r.phase !== "waiting").length ?? 0;
  const lobbies = live?.rooms.filter((r) => r.humans > 0 && r.phase === "waiting").length ?? 0;
  const o = overview;
  return (
    <div className={s.kpis}>
      <Kpi live label="Online now" value={live ? num(live.players.length) : "—"}
        sub={live ? `Peak ${live.peakSinceStart.players} since ${dateTime(live.peakSinceStart.at)}` : undefined} />
      <Kpi label="Active matches" value={live ? num(activeMatches) : "—"} sub={live ? `${lobbies} lobb${lobbies === 1 ? "y" : "ies"} waiting · ${live.rooms.length} rooms` : undefined} />
      <Kpi label="Players today" value={o ? num(o.today.players) : "—"} sub={o ? `${num(o.today.newPlayers)} new · ${num(o.d7.players)} this week` : undefined}>
        {o && <Sparkline values={o.dau.map((d) => d.players)} />}
      </Kpi>
      <Kpi label="Sessions today" value={o ? num(o.today.sessions) : "—"} sub={o ? `${num(o.d30.sessions)} in 30 days` : undefined} />
      <Kpi label="Avg session" value={o ? duration(o.d7.avgSessionMs) : "—"} sub="last 7 days" />
      <Kpi label="Play time today" value={o ? duration(o.today.playTimeMs) : "—"} sub={o ? `${duration(o.d7.playTimeMs)} this week` : undefined} />
      <Kpi label="Peak online today" value={o ? num(o.peak.today.players) : "—"} sub={o?.peak.d30.at ? `30-day peak ${o.peak.d30.players} · ${dayLabel(o.peak.d30.at.slice(0, 10))}` : "sampled every minute"} />
      <Kpi label="Total players" value={o ? num(o.totalPlayers) : "—"} sub={o ? `${num(o.totalMatches)} matches recorded` : undefined} />
    </div>
  );
}

/** `now` is the server-aligned clock, ticking every second. */
export function LiveView({ live, error, onPlayer, now }: { live: LiveSnapshot | null; error: string | null; onPlayer: (pid: string) => void; now: number }) {
  const cols: Col<LivePlayer>[] = [
    { key: "name", label: "Player", lead: true, render: (p) => (
      <div className={s.who}>
        <b>{p.name}</b>
        <small>{p.connected ? (p.alive ? "In play" : "Respawning") : "Reconnecting…"} · {p.pid.slice(0, 8)}</small>
      </div>
    ) },
    { key: "loc", label: "Location", render: (p) => <span className={s.nowrap}><span className={s.flag} aria-hidden>{flag(p.geo)}</span> {place(p.geo)}</span> },
    { key: "ip", label: "IP address", render: (p) => <code className={s.mono}>{p.ip || "—"}</code> },
    { key: "device", label: "Device", render: (p) => <span className={s.nowrap}><span aria-hidden>{deviceIcon(p.client)}</span> {device(p.client)}</span> },
    { key: "room", label: "Room", render: (p) => (
      <div className={s.who}><b>{p.roomName}</b><small>{p.roomId} · {mapName(p.map)} · {modeShort(p.mode)} · {phaseLabel[p.phase] ?? p.phase}</small></div>
    ) },
    { key: "team", label: "Team", render: (p) => <TeamPill team={p.team} /> },
    { key: "kda", label: "K / D / A", align: "right", render: (p) => <span className={s.mono}>{p.kills} / {p.deaths} / {p.assists}</span> },
    { key: "score", label: "Score", align: "right", minor: true, render: (p) => num(p.score) },
    { key: "acc", label: "Session K/D", align: "right", minor: true, render: (p) => kd(p.session.kills, p.session.deaths) },
    { key: "ping", label: "Ping", align: "right", render: (p) => <Pill tone={pingTone(p.ping)}>{p.ping ? `${p.ping} ms` : "—"}</Pill> },
    { key: "time", label: "Session", align: "right", render: (p) => <span className={s.mono}>{duration(now - p.joinedAt)}</span> },
  ];
  return (
    <div className={s.stack}>
      {error && <Notice tone="bad">{error}</Notice>}
      <Card title={<>Online now <span className={s.count}>{live?.players.length ?? 0}</span></>} sub="Real players only — bots are never listed. Refreshes every 5 seconds.">
        <Table wide rows={live?.players ?? []} cols={cols} rowKey={(p) => p.sessionId} onRow={(p) => onPlayer(p.pid)} rowLabel={(p) => `Open ${p.name}`}
          empty={live ? "Nobody is playing right now." : "Connecting to the game server…"} />
      </Card>
      <Card title={<>Rooms <span className={s.count}>{live?.rooms.length ?? 0}</span></>} sub="Every open room on the game server, including private ones.">
        {live && live.rooms.length ? (
          <div className={s.roomGrid}>{live.rooms.map((r) => <RoomCard key={r.roomId} room={r} now={now} players={live.players.filter((p) => p.roomId === r.roomId)} onPlayer={onPlayer} />)}</div>
        ) : <p className={s.empty}>No rooms open.</p>}
      </Card>
    </div>
  );
}

function RoomCard({ room: r, now, players, onPlayer }: { room: LiveRoom; now: number; players: LivePlayer[]; onPlayer: (pid: string) => void }) {
  const left = r.phaseEndsAt > now && r.phase !== "waiting" ? duration(r.phaseEndsAt - now) : null;
  return (
    <article className={s.room}>
      <header>
        <div>
          <b>{r.roomName}</b>
          <small>{r.roomId}{r.privateRoom ? " · private" : ""} · {r.queue === "quick" ? "Quick play" : r.format !== "custom" ? r.format : "Custom"}</small>
        </div>
        <Pill tone={r.phase === "live" ? "good" : r.phase === "waiting" ? "muted" : "warn"}>{phaseLabel[r.phase] ?? r.phase}{left ? ` · ${left}` : ""}</Pill>
      </header>
      <dl className={s.roomFacts}>
        <div><dt>Map</dt><dd>{mapName(r.map)}</dd></div>
        <div><dt>Mode</dt><dd>{modeShort(r.mode)} to {r.scoreLimit}</dd></div>
        <div><dt>Players</dt><dd>{r.humans} + {r.bots} bots / {r.maxPlayers}</dd></div>
        {r.mode === "tdm" && <div><dt>Score</dt><dd><span className={s.blueText}>{r.team1}</span> – <span className={s.redText}>{r.team2}</span></dd></div>}
      </dl>
      {players.length > 0 && (
        <div className={s.roomPlayers}>
          {players.map((p) => (
            <button type="button" key={p.sessionId} className={s.chip} onClick={() => onPlayer(p.pid)}>
              <span aria-hidden>{flag(p.geo)}</span> {p.name} <small>{p.kills}/{p.deaths}</small>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
