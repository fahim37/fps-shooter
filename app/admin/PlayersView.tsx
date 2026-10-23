"use client";

import { useEffect, useMemo, useState } from "react";
import type { Page, PlayerDetail, PlayerDoc, PlayerMatchRow, PlayerSort, SessionDoc, Wire } from "@/game/shared/adminApi";
import s from "./admin.module.css";
import { api } from "./api";
import { Card, Drawer, Loading, Notice, Pager, Pill, Table, useLoad, type Col } from "./ui";
import { BarList, ColumnChart } from "./charts";
import {
  ago, dateTime, dayLabel, device, deviceIcon, duration, flag, kd, mapName, modeShort, num, pct, place, ratio, weaponName,
} from "./format";
import { TeamPill, pingTone } from "./LiveView";

type P = Wire<PlayerDoc>;

const SORTS: { key: PlayerSort; label: string }[] = [
  { key: "lastSeen", label: "Last seen" },
  { key: "firstSeen", label: "First seen" },
  { key: "playTimeMs", label: "Play time" },
  { key: "sessions", label: "Sessions" },
  { key: "kills", label: "Kills" },
  { key: "kd", label: "K/D" },
  { key: "score", label: "Score" },
];

export function PlayersView({ onPlayer, onUnauthorized, liveIds }: { onPlayer: (pid: string) => void; onUnauthorized: () => void; liveIds: Set<string> }) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<PlayerSort>("lastSeen");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => { setQ(input.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [input]);
  const key = `${q}|${sort}|${page}`;
  const res = useLoad(() => api<Wire<Page<PlayerDoc>>>("/players", { q, sort, page, size: 25 }), key, onUnauthorized);

  const cols: Col<P>[] = [
    { key: "name", label: "Player", lead: true, render: (p) => (
      <div className={s.who}>
        <b>{liveIds.has(p._id) && <i className={s.liveDot} title="Online now" />}{p.lastName}</b>
        <small>{p.names.length > 1 ? `aka ${p.names.filter((n) => n !== p.lastName).slice(0, 3).join(", ")}` : p._id.slice(0, 13)}</small>
      </div>
    ) },
    { key: "loc", label: "Location", render: (p) => <span className={s.nowrap}><span className={s.flag} aria-hidden>{flag(p.lastGeo)}</span> {place(p.lastGeo)}</span> },
    { key: "ip", label: "Last IP", minor: true, render: (p) => <code className={s.mono}>{p.lastIp || "—"}</code> },
    { key: "seen", label: "Last seen", render: (p) => <span title={dateTime(p.lastSeen)}>{liveIds.has(p._id) ? "Online now" : ago(p.lastSeen)}</span> },
    { key: "sessions", label: "Sessions", align: "right", render: (p) => num(p.sessions) },
    { key: "time", label: "Play time", align: "right", render: (p) => duration(p.playTimeMs) },
    { key: "kd", label: "K/D", align: "right", render: (p) => <span className={s.mono}>{kd(p.kills, p.deaths)}</span> },
    { key: "kills", label: "Kills", align: "right", minor: true, render: (p) => num(p.kills) },
    { key: "acc", label: "Accuracy", align: "right", minor: true, render: (p) => (p.shots ? pct(p.hits / p.shots) : "—") },
    { key: "device", label: "Device", minor: true, render: (p) => <span className={s.nowrap}>{deviceIcon(p.lastClient)} {p.lastClient.os}</span> },
  ];

  return (
    <Card title="Players" sub="Everyone who has played, identified by an anonymous id stored in their browser.">
      <div className={s.toolbar}>
        <input type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search name, IP, city or id" aria-label="Search players" className={s.search} />
        <label className={s.inlineLabel}>
          <span>Sort</span>
          <select value={sort} onChange={(e) => { setSort(e.target.value as PlayerSort); setPage(1); }}>
            {SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        {res.data && <span className={s.muted}>{num(res.data.total)} players</span>}
      </div>
      {res.error && <Notice tone="bad">{res.error}</Notice>}
      {!res.data && res.loading ? <Loading /> : (
        <div className={res.loading ? s.refreshing : undefined}>
          <Table wide rows={res.data?.items ?? []} cols={cols} rowKey={(p) => p._id} onRow={(p) => onPlayer(p._id)} rowLabel={(p) => `Open ${p.lastName}`}
            empty={q ? "No players match that search." : "No players recorded yet."} />
          {res.data && <Pager page={res.data.page} size={res.data.size} total={res.data.total} onPage={setPage} />}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className={s.stat}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
}

export function PlayerDrawer({ pid, onClose, onMatch, onUnauthorized, online }: {
  pid: string; onClose: () => void; onMatch: (id: string) => void; onUnauthorized: () => void; online: boolean;
}) {
  const res = useLoad(() => api<Wire<PlayerDetail>>(`/players/${encodeURIComponent(pid)}`), pid, onUnauthorized);
  const d = res.data;
  const p = d?.player;
  return (
    <Drawer onClose={onClose}
      title={p ? <h2>{online && <i className={s.liveDot} title="Online now" />}{p.lastName}</h2> : <h2>Player</h2>}
      sub={p ? <>First seen {dateTime(p.firstSeen)} · last seen {online ? "now" : ago(p.lastSeen)} · <code className={s.mono}>{p._id}</code></> : null}>
      {res.error && <Notice tone={res.error === "Not found" ? "warn" : "bad"}>{res.error === "Not found" ? "No finished sessions recorded for this player yet — stats appear after their first session ends." : res.error}</Notice>}
      {!d && res.loading && <Loading />}
      {d && p && <PlayerBody d={d} onMatch={onMatch} />}
    </Drawer>
  );
}

function PlayerBody({ d, onMatch }: { d: Wire<PlayerDetail>; onMatch: (id: string) => void }) {
  const p = d.player;
  const activity = useMemo(() => {
    const byDay = new Map<string, number>();
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const t = new Date(start.getTime() - i * 86_400_000);
      const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      days.push(k); byDay.set(k, 0);
    }
    for (const sess of d.sessions) {
      const t = new Date(sess.joinedAt);
      const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      if (byDay.has(k)) byDay.set(k, byDay.get(k)! + sess.durationMs);
    }
    return days.map((k) => ({ label: dayLabel(k), value: Math.round((byDay.get(k) ?? 0) / 60_000) }));
  }, [d.sessions]);

  const sessionCols: Col<Wire<SessionDoc>>[] = [
    { key: "when", label: "Joined", lead: true, render: (x) => <div className={s.who}><b>{dateTime(x.joinedAt)}</b><small>{duration(x.durationMs)} · as {x.name}</small></div> },
    { key: "room", label: "Room", render: (x) => <div className={s.who}><b>{mapName(x.map)} · {modeShort(x.mode)}</b><small>{x.roomName} ({x.roomId})</small></div> },
    { key: "kda", label: "K / D / A", align: "right", render: (x) => <span className={s.mono}>{x.kills} / {x.deaths} / {x.assists}</span> },
    { key: "acc", label: "Accuracy", align: "right", render: (x) => (x.shots ? pct(x.accuracy) : "—") },
    { key: "ping", label: "Ping", align: "right", render: (x) => (x.ping ? <Pill tone={pingTone(x.ping.avg)}>{x.ping.avg} ms</Pill> : "—") },
    { key: "ip", label: "IP", minor: true, render: (x) => <code className={s.mono}>{x.ip || "—"}</code> },
    { key: "loc", label: "Location", minor: true, render: (x) => <span className={s.nowrap}>{flag(x.geo)} {place(x.geo)}</span> },
    { key: "device", label: "Device", minor: true, render: (x) => <span className={s.nowrap}>{device(x.client)}</span> },
  ];
  const matchCols: Col<Wire<PlayerMatchRow>>[] = [
    { key: "when", label: "Match", lead: true, render: (m) => <div className={s.who}><b>{mapName(m.map)} · {modeShort(m.mode)}</b><small>{dateTime(m.endedAt)} · {duration(m.durationMs)}</small></div> },
    { key: "result", label: "Result", render: (m) => <Pill tone={m.left ? "muted" : m.won ? "good" : "bad"}>{m.left ? "Left early" : m.won ? "Won" : "Lost"}</Pill> },
    { key: "team", label: "Team", render: (m) => <TeamPill team={m.team} /> },
    { key: "place", label: "Place", align: "right", render: (m) => `#${m.place} of ${m.players}` },
    { key: "kda", label: "K / D / A", align: "right", render: (m) => <span className={s.mono}>{m.kills} / {m.deaths} / {m.assists}</span> },
    { key: "score", label: "Score", align: "right", render: (m) => num(m.score) },
  ];

  return (
    <div className={s.stack}>
      <div className={s.statGrid}>
        <Stat label="Play time" value={duration(p.playTimeMs)} sub={`${num(p.sessions)} sessions · avg ${duration(p.playTimeMs / Math.max(1, p.sessions))}`} />
        <Stat label="K/D" value={kd(p.kills, p.deaths)} sub={`${num(p.kills)} kills · ${num(p.deaths)} deaths`} />
        <Stat label="Assists" value={num(p.assists)} sub={`${num(p.score)} score`} />
        <Stat label="Accuracy" value={p.shots ? pct(p.hits / p.shots, 1) : "—"} sub={`${num(p.hits)} hits of ${num(p.shots)} shots`} />
        <Stat label="Headshots" value={p.kills ? pct(p.headshots / p.kills) : "—"} sub={`${num(p.headshots)} headshot kills`} />
        <Stat label="Matches" value={num(p.matches)} sub={p.matches ? `${num(p.wins)} won · ${pct(p.wins / p.matches)}` : "none finished"} />
        <Stat label="Best streak" value={num(p.bestStreak)} sub={`${num(p.grenadeKills)} grenade kills`} />
        <Stat label="Damage" value={num(p.damageDealt)} sub={`taken ${num(p.damageTaken)} · ratio ${ratio(p.damageDealt, p.damageTaken).toFixed(2)}`} />
      </div>

      <Card title="Identity" sub="Every name, address, place and device seen for this player id.">
        <dl className={s.identity}>
          <div><dt>Names</dt><dd>{p.names.map((n) => <Pill key={n}>{n}</Pill>)}</dd></div>
          <div><dt>IP addresses</dt><dd>{p.ips.map((ip) => <code key={ip} className={s.mono}>{ip}</code>)}</dd></div>
          <div><dt>Locations</dt><dd>{p.locations.map((l) => <span key={l}>{l}</span>)}</dd></div>
          <div><dt>Last location</dt><dd>{flag(p.lastGeo)} {place(p.lastGeo)}{p.lastGeo.region ? `, ${p.lastGeo.region}` : ""}{p.lastGeo.lat != null ? <> · <a href={`https://www.openstreetmap.org/?mlat=${p.lastGeo.lat}&mlon=${p.lastGeo.lon}#map=9/${p.lastGeo.lat}/${p.lastGeo.lon}`} target="_blank" rel="noreferrer noopener">map ↗</a></> : null}{p.lastGeo.timezone ? ` · ${p.lastGeo.timezone}` : ""}</dd></div>
          <div><dt>Devices</dt><dd>{p.devices.map((x) => <span key={x}>{x}</span>)}</dd></div>
          <div><dt>Last played</dt><dd>{mapName(p.lastMap)} · {modeShort(p.lastMode)}</dd></div>
        </dl>
        <p className={s.fine}>Locations are approximate (city-level, from an offline IP database) and can be wrong for VPNs and mobile networks.</p>
      </Card>

      <Card title="Minutes played per day" sub="Last 30 days, your local time">
        <ColumnChart data={activity} format={(v) => `${v} min`} tickFormat={(v) => `${v}`} height={150} title="Minutes played per day" />
      </Card>

      <div className={s.twoCol}>
        <Card title="Weapons" sub="Kills and deaths by weapon">
          <Table rows={d.weapons} rowKey={(w) => w.weapon} empty="No eliminations yet." cols={[
            { key: "w", label: "Weapon", lead: true, render: (w) => <b>{weaponName(w.weapon)}</b> },
            { key: "k", label: "Kills", align: "right", render: (w) => num(w.kills) },
            { key: "d", label: "Deaths", align: "right", render: (w) => num(w.deaths) },
            { key: "hs", label: "HS", align: "right", render: (w) => (w.kills ? pct(w.headshots / w.kills) : "—") },
            { key: "dist", label: "Avg dist", align: "right", render: (w) => (w.avgDistance != null ? `${w.avgDistance} m` : "—") },
          ]} />
        </Card>
        <Card title="Rivals">
          <h3 className={s.subhead}>Eliminates most</h3>
          <BarList rows={d.victims.map((v) => ({ key: v.pid ?? v.name, label: <>{v.name}{v.bot && <small className={s.botTag}>bot</small>}</>, value: v.count }))} format={num} empty="No kills yet." />
          <h3 className={s.subhead}>Eliminated most by</h3>
          <BarList rows={d.nemeses.map((v) => ({ key: v.pid ?? v.name, label: <>{v.name}{v.bot && <small className={s.botTag}>bot</small>}</>, value: v.count }))} format={num} empty="Never eliminated." />
        </Card>
      </div>

      <Card title="Recent matches" sub="Click a match for its full scoreboard">
        <Table rows={d.matches} cols={matchCols} rowKey={(m) => m.matchId} onRow={(m) => onMatch(m.matchId)} rowLabel={(m) => `Open match on ${mapName(m.map)}`} empty="No finished matches yet." />
      </Card>

      <Card title={<>Sessions <span className={s.count}>{d.sessions.length}</span></>} sub="Most recent first (up to 200)">
        <Table wide rows={d.sessions} cols={sessionCols} rowKey={(x) => x._id} empty="No sessions." />
      </Card>
    </div>
  );
}
