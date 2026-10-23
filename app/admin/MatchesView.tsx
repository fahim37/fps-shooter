"use client";

import { useState } from "react";
import type { MatchDetail, MatchDoc, MatchParticipant, Page, Wire } from "@/game/shared/adminApi";
import s from "./admin.module.css";
import { api } from "./api";
import { Card, Drawer, Loading, Notice, Pager, Pill, Table, useLoad, type Col } from "./ui";
import { dateTime, duration, kd, mapName, modeName, modeShort, num, weaponName } from "./format";
import { TeamPill } from "./LiveView";

type M = Wire<MatchDoc>;

const MAPS = ["village", "downtown", "industrial", "outpost"];

export function matchResult(m: Pick<M, "mode" | "winner" | "team1" | "team2" | "endReason">) {
  if (m.endReason === "abandoned") {
    return <><Pill tone="warn">Abandoned</Pill>{m.mode === "tdm" && <> <span className={s.mono}><span className={s.blueText}>{m.team1}</span>–<span className={s.redText}>{m.team2}</span></span></>}</>;
  }
  if (m.mode === "tdm") {
    if (m.winner === "draw") return <><Pill tone="muted">Draw</Pill> <span className={s.mono}>{m.team1}–{m.team2}</span></>;
    return <><TeamPill team={m.winner === "1" ? 1 : 2} /> won <span className={s.mono}><span className={s.blueText}>{m.team1}</span>–<span className={s.redText}>{m.team2}</span></span></>;
  }
  return <>{m.winner ? <><b>{m.winner}</b> won</> : "—"}</>;
}

const reason = { score: "Score limit", time: "Time limit", abandoned: "Abandoned" } as const;

export function MatchesView({ onMatch, onUnauthorized }: { onMatch: (id: string) => void; onUnauthorized: () => void }) {
  const [map, setMap] = useState("");
  const [mode, setMode] = useState("");
  const [page, setPage] = useState(1);
  const res = useLoad(() => api<Wire<Page<MatchDoc>>>("/matches", { map, mode, page, size: 25 }), `${map}|${mode}|${page}`, onUnauthorized);
  const cols: Col<M>[] = [
    { key: "when", label: "Ended", lead: true, render: (m) => <div className={s.who}><b>{mapName(m.map)} · {modeShort(m.mode)}</b><small>{dateTime(m.endedAt)} · {m.roomName}</small></div> },
    { key: "result", label: "Result", render: matchResult },
    { key: "dur", label: "Length", align: "right", render: (m) => duration(m.durationMs) },
    { key: "players", label: "Players", align: "right", render: (m) => <>{m.humans} <small className={s.muted}>+{m.bots} bots</small></> },
    { key: "top", label: "Top player", minor: true, render: (m) => { const t = m.participants[0]; return t ? <>{t.name}{t.bot && <small className={s.botTag}>bot</small>} <small className={s.muted}>{t.kills}/{t.deaths}</small></> : "—"; } },
    { key: "why", label: "Ended by", minor: true, render: (m) => <Pill tone={m.endReason === "abandoned" ? "warn" : "muted"}>{reason[m.endReason]}</Pill> },
  ];
  return (
    <Card title="Matches" sub="Every match with at least one real player, newest first.">
      <div className={s.toolbar}>
        <label className={s.inlineLabel}><span>Map</span>
          <select value={map} onChange={(e) => { setMap(e.target.value); setPage(1); }}>
            <option value="">All maps</option>
            {MAPS.map((m) => <option key={m} value={m}>{mapName(m)}</option>)}
          </select>
        </label>
        <label className={s.inlineLabel}><span>Mode</span>
          <select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }}>
            <option value="">All modes</option>
            <option value="tdm">Team Deathmatch</option>
            <option value="ffa">Free for all</option>
          </select>
        </label>
        {res.data && <span className={s.muted}>{num(res.data.total)} matches</span>}
      </div>
      {res.error && <Notice tone="bad">{res.error}</Notice>}
      {!res.data && res.loading ? <Loading /> : (
        <div className={res.loading ? s.refreshing : undefined}>
          <Table wide rows={res.data?.items ?? []} cols={cols} rowKey={(m) => m._id} onRow={(m) => onMatch(m._id)} rowLabel={(m) => `Open match on ${mapName(m.map)}`} empty="No matches recorded yet." />
          {res.data && <Pager page={res.data.page} size={res.data.size} total={res.data.total} onPage={setPage} />}
        </div>
      )}
    </Card>
  );
}

function Scoreboard({ rows, onPlayer }: { rows: MatchParticipant[]; onPlayer: (pid: string) => void }) {
  const cols: Col<MatchParticipant>[] = [
    { key: "name", label: "Player", lead: true, render: (p) => (
      <div className={s.who}>
        <b>{p.name}{p.bot && <small className={s.botTag}>bot</small>}{p.won && !p.bot && <small className={s.winTag}>won</small>}</b>
        <small>{p.left ? "Left before the end" : p.bot ? "Computer player" : "Real player"}</small>
      </div>
    ) },
    { key: "score", label: "Score", align: "right", render: (p) => num(p.score) },
    { key: "k", label: "K", align: "right", render: (p) => num(p.kills) },
    { key: "d", label: "D", align: "right", render: (p) => num(p.deaths) },
    { key: "a", label: "A", align: "right", render: (p) => num(p.assists) },
    { key: "kd", label: "K/D", align: "right", render: (p) => kd(p.kills, p.deaths) },
  ];
  return <Table rows={rows} cols={cols} rowKey={(p) => p.sessionId} onRow={(p) => { if (p.pid) onPlayer(p.pid); }} rowLabel={(p) => `${p.name}`} />;
}

export function MatchDrawer({ id, onClose, onPlayer, onUnauthorized }: { id: string; onClose: () => void; onPlayer: (pid: string) => void; onUnauthorized: () => void }) {
  const res = useLoad(() => api<Wire<MatchDetail>>(`/matches/${encodeURIComponent(id)}`), id, onUnauthorized);
  const m = res.data?.match;
  const startedAt = m ? +new Date(m.startedAt) : 0;
  return (
    <Drawer onClose={onClose} title={<h2>{m ? `${mapName(m.map)} · ${modeName(m.mode)}` : "Match"}</h2>}
      sub={m ? <>{dateTime(m.startedAt)} · {duration(m.durationMs)} · {reason[m.endReason]} · room {m.roomName} ({m.roomId})</> : null}>
      {res.error && <Notice tone="bad">{res.error}</Notice>}
      {!m && res.loading && <Loading />}
      {m && res.data && (
        <div className={s.stack}>
          <div className={s.matchHero}>
            <div>{matchResult(m)}</div>
            <small>{m.humans} real players · {m.bots} bots · first to {m.scoreLimit}</small>
          </div>
          {m.mode === "tdm" ? (
            [1, 2].map((team) => (
              <Card key={team} title={<><TeamPill team={team} /> <span className={s.mono}>{team === 1 ? m.team1 : m.team2}</span></>}>
                <Scoreboard rows={m.participants.filter((p) => p.team === team)} onPlayer={onPlayer} />
              </Card>
            ))
          ) : (
            <Card title="Scoreboard"><Scoreboard rows={m.participants} onPlayer={onPlayer} /></Card>
          )}
          <Card title={<>Kill feed <span className={s.count}>{res.data.kills.length}</span></>} sub="Eliminations involving real players">
            {res.data.kills.length ? (
              <ol className={s.feed}>
                {res.data.kills.map((k, i) => (
                  <li key={i}>
                    <span className={s.mono}>{duration(+new Date(k.at) - startedAt)}</span>
                    <span><b className={k.killerBot ? s.muted : undefined}>{k.killerName}</b> <small>{weaponName(k.weapon)}{k.headshot ? " · headshot" : ""}{k.distance != null ? ` · ${k.distance} m` : ""}</small> <b className={k.victimBot ? s.muted : undefined}>{k.victimName}</b></span>
                  </li>
                ))}
              </ol>
            ) : <p className={s.empty}>No eliminations recorded.</p>}
          </Card>
        </div>
      )}
    </Drawer>
  );
}
