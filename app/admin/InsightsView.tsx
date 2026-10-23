"use client";

import { useState } from "react";
import type { AnalyticsSeries, Wire } from "@/game/shared/adminApi";
import s from "./admin.module.css";
import { api, viewerTimeZone } from "./api";
import { Card, Loading, Notice, Table, useLoad } from "./ui";
import { BarList, ColumnChart, Heatmap, LineChart } from "./charts";
import { dayLabel, duration, flag, kd, mapName, modeName, num, pct, short, weaponName } from "./format";

const RANGES = [7, 30, 90] as const;

export function InsightsView({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [days, setDays] = useState<number>(30);
  const res = useLoad(() => api<Wire<AnalyticsSeries>>("/analytics", { days, tz: viewerTimeZone }), String(days), onUnauthorized);
  const a = res.data;
  const daily = (pick: (d: AnalyticsSeries["daily"][number]) => number) => a?.daily.map((d) => ({ label: dayLabel(d.day), value: pick(d) })) ?? [];
  const totals = a?.daily.reduce((t, d) => ({ sessions: t.sessions + d.sessions, play: t.play + d.playTimeMs, fresh: t.fresh + d.newPlayers, matches: t.matches + d.matches }), { sessions: 0, play: 0, fresh: 0, matches: 0 });
  const countries = a?.countries ?? [];
  const totalCountryPlayers = countries.reduce((n, c) => n + c.players, 0);

  return (
    <div className={s.stack}>
      <div className={s.toolbar} role="group" aria-label="Date range">
        <div className={s.segmented}>
          {RANGES.map((r) => (
            <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}>Last {r} days</button>
          ))}
        </div>
        <span className={s.muted}>Times in {viewerTimeZone}</span>
      </div>
      {res.error && <Notice tone="bad">{res.error}</Notice>}
      {!a && res.loading && <Loading />}
      {a && totals && (
        <div className={`${s.stack} ${res.loading ? s.refreshing : ""}`}>
          <div className={s.grid2}>
            <Card title="Daily active players" sub={`Unique players per day · ${num(totals.fresh)} new in ${days} days`}>
              <LineChart data={daily((d) => d.players)} format={(v) => `${num(v)} players`} tickFormat={short} title="Daily active players" />
            </Card>
            <Card title="Sessions per day" sub={`${num(totals.sessions)} sessions · ${num(totals.matches)} matches`}>
              <ColumnChart data={daily((d) => d.sessions)} format={(v) => `${num(v)} sessions`} tickFormat={short} title="Sessions per day" />
            </Card>
            <Card title="Play time per day" sub={`${duration(totals.play)} in total`}>
              <ColumnChart data={daily((d) => d.playTimeMs / 3_600_000)} format={(h) => duration(h * 3_600_000)} tickFormat={(h) => `${h}h`} title="Play time per day" />
            </Card>
            <Card title="New players per day" sub="First visit from a new browser">
              <ColumnChart data={daily((d) => d.newPlayers)} format={(v) => `${num(v)} new`} tickFormat={short} title="New players per day" />
            </Card>
          </div>

          <Card title="When people play" sub="Sessions started, by weekday and hour">
            <Heatmap grid={a.heatmap} />
          </Card>

          <div className={s.grid3}>
            <Card title="Countries" sub={`${countries.length} countries · by unique players`}>
              <BarList rows={countries.slice(0, 12).map((c) => ({
                key: c.key, value: c.players, sub: `${c.sessions} sessions`,
                label: <><span className={s.flag} aria-hidden>{flag({ country: c.key })}</span> {c.key === "LAN" ? "Local network" : c.label}</>,
              }))} format={(v) => `${num(v)} · ${pct(v / Math.max(1, totalCountryPlayers))}`} />
            </Card>
            <Card title="Devices" sub="Unique players">
              <BarList rows={a.devices.map((d) => ({ key: d.key, label: d.key === "mobile" ? "Phone" : d.key[0].toUpperCase() + d.key.slice(1), value: d.players, sub: `${d.sessions} sessions` }))} format={num} />
              <h3 className={s.subhead}>Operating systems</h3>
              <BarList rows={a.os.slice(0, 6).map((d) => ({ key: d.key, label: d.label, value: d.players }))} format={num} />
            </Card>
            <Card title="Browsers" sub="Unique players">
              <BarList rows={a.browsers.slice(0, 8).map((d) => ({ key: d.key, label: d.label, value: d.players, sub: `${d.sessions} sessions` }))} format={num} />
            </Card>
          </div>

          <div className={s.grid2}>
            <Card title="Maps" sub="Play time and finished matches">
              <BarList rows={a.maps.map((m) => ({ key: m.key, label: mapName(m.key), value: m.playTimeMs, sub: `${m.matches} matches · ${m.sessions} sessions` }))} format={(v) => duration(v)} />
            </Card>
            <Card title="Modes" sub="Play time and finished matches">
              <BarList rows={a.modes.map((m) => ({ key: m.key, label: modeName(m.key), value: m.playTimeMs, sub: `${m.matches} matches · ${m.sessions} sessions` }))} format={(v) => duration(v)} />
            </Card>
          </div>

          <Card title="Weapons" sub="Kills by real players, and real players eliminated by each weapon (bots included as attackers)">
            <Table rows={a.weapons} rowKey={(w) => w.weapon} empty="No eliminations recorded yet." cols={[
              { key: "w", label: "Weapon", lead: true, render: (w) => <b>{weaponName(w.weapon)}</b> },
              { key: "share", label: "Kill share", render: (w) => {
                const all = a.weapons.reduce((n, x) => n + x.kills, 0);
                const top = Math.max(1, ...a.weapons.map((x) => x.kills));
                return <span className={s.inlineBar}><span><i style={{ width: `${(w.kills / top) * 100}%` }} /></span><em>{pct(w.kills / Math.max(1, all))}</em></span>;
              } },
              { key: "k", label: "Kills", align: "right", render: (w) => num(w.kills) },
              { key: "d", label: "Players killed by it", align: "right", render: (w) => num(w.deaths) },
              { key: "kd", label: "K/D", align: "right", render: (w) => kd(w.kills, w.deaths) },
              { key: "hs", label: "Headshots", align: "right", render: (w) => (w.kills ? pct(w.headshots / w.kills) : "—") },
              { key: "dist", label: "Avg distance", align: "right", render: (w) => (w.avgDistance != null ? `${w.avgDistance} m` : "—") },
            ]} />
          </Card>
        </div>
      )}
    </div>
  );
}
