"use client";

import { memo } from "react";
import { useHud } from "./core/hud";
import styles from "./MatchStats.module.css";

const ICONS = {
  kills: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /><circle cx="12" cy="12" r="1.4" className={styles.solid} /></svg>,
  deaths: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-4.4 0-8 3.2-8 7.4 0 2.6 1.3 4.5 3 5.6V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3c1.7-1.1 3-3 3-5.6C20 6.2 16.4 3 12 3Z" /><circle cx="9" cy="11" r="1.8" className={styles.solid} /><circle cx="15" cy="11" r="1.8" className={styles.solid} /><path d="M10 20v-2.5M14 20v-2.5" /></svg>,
  assists: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12.5 7 8.5l3 1.5 3-2 4 1.5 4 3" /><path d="M7 8.5 3 12.5l5 5 2-1.5 2 1.5 2-1.5 2 1.5 5-5-3.5-2.5" /><path d="M10 10l3.5 3.5M12 9l3 3" /></svg>,
  ratio: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19 10 11l4 4 6-9" /><path d="M15 6h5v5" /></svg>,
};

/** Your own K / D / A for the match, top left. */
export const MatchStats = memo(function MatchStats() {
  const me = useHud((h) => h.players.find((p) => p.me));
  if (!me) return null;
  // Older servers do not replicate every stat yet: show 0, never "undefined".
  const kills = me.kills ?? 0, deaths = me.deaths ?? 0, assists = me.assists ?? 0;
  const ratio = deaths ? kills / deaths : kills;
  const cells: [keyof typeof ICONS, string, string][] = [
    ["kills", "KILLS", String(kills)],
    ["deaths", "DEATHS", String(deaths)],
    ["assists", "ASSISTS", String(assists)],
    ["ratio", "K/D", ratio.toFixed(ratio >= 10 ? 1 : 2)],
  ];
  return <dl className={styles.card} aria-label="Your match stats">
    {cells.map(([icon, label, value]) => <div key={icon} className={styles.cell} data-stat={icon}>
      <dt>{ICONS[icon]}<span>{label}</span></dt>
      <dd>{value}</dd>
    </div>)}
  </dl>;
});
