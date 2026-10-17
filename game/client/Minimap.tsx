import { memo } from "react";
import { getMap, MAPS } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";
import { bearingYaw, mapHeading, mapPoint, threatStrength } from "./core/minimap";
import { SQUAD_COLORS } from "./core/squad";
import { useHud } from "./core/hud";
import styles from "./Minimap.module.css";

const Terrain = memo(function Terrain({ map }: { map: MapId }) {
  // The same roads, plazas and footprints the map was built from.
  const { half, overview } = getMap(map);
  const scale = 90 / (half * 2);
  const rect = (r: { x: number; z: number; sx: number; sz: number }) => {
    const point = mapPoint(r.x, r.z, half);
    return { x: point.x, y: point.y, width: r.sx * scale, height: r.sz * scale };
  };
  return <g aria-hidden="true">
    <rect x="5" y="5" width="90" height="90" rx="2" className={styles.ground} />
    <path d="M20 5V95M35 5V95M50 5V95M65 5V95M80 5V95M5 20H95M5 35H95M5 50H95M5 65H95M5 80H95" className={styles.grid} />
    {overview.roads.map((road, index) => <rect key={index} {...rect(road)} className={styles.road} />)}
    {overview.plazas.map((plaza, index) => <rect key={index} {...rect(plaza)} rx="1" className={styles.plaza} />)}
    {overview.buildings.map((building, index) => <rect key={index} {...rect(building)} rx="0.4" className={styles.building} />)}
    <path d="m50 2-1 2h2Z" fill="#d9ed79" /><text x="50" y="10" className={styles.north}>N</text>
    {overview.labels.map((label) => {
      const point = mapPoint(label.x, label.z, half);
      return <text key={label.text} x={point.x} y={point.y + 1.5} className={styles.plazaLabel}>{label.text}</text>;
    })}
  </g>;
});

export const Minimap = memo(function Minimap({ now, map }: { now: number; map: MapId }) {
  const { half } = getMap(map);
  const players = useHud((state) => state.mapPlayers);
  const threats = useHud((state) => state.threats);
  const self = players.find((player) => player.relation === "self");
  const localY = self?.y;
  // Paint the local arrow last so it stays recognizable when players overlap.
  const ordered = [...players.filter((player) => player.relation !== "self"), ...players.filter((player) => player.relation === "self")];
  const origin = self ? mapPoint(self.x, self.z, half) : null;
  return <section className={styles.panel} aria-label="Minimap">
    <div className={styles.heading}><span>{MAPS[map].name.toUpperCase()}</span><small>SQUAD ONLY</small></div>
    <svg viewBox="0 0 100 100" className={styles.map} role="img" aria-label={`North-up ${MAPS[map].name} map with your squad and recent hit directions`}>
      <defs>
        <linearGradient id="minimap-threat" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ff4a3d" stopOpacity=".9" /><stop offset=".55" stopColor="#ff4a3d" stopOpacity=".35" /><stop offset="1" stopColor="#ff4a3d" stopOpacity="0" /></linearGradient>
      </defs>
      <Terrain map={map} />
      {self && origin && threats.map((threat) => {
        const strength = threatStrength(threat, now);
        if (strength <= 0) return null;
        // Direction only: a fixed-length cone never reveals how far away the shooter is.
        const heading = mapHeading(bearingYaw(threat.from[0] - self.x, threat.from[2] - self.z));
        const width = threat.kind === "explosion" ? 9 : 5.5;
        const height = threat.from[1] - self.y;
        const label = `Hit from ${threat.kind === "explosion" ? "an explosion" : "gunfire"}${height > 2.5 ? " above you" : height < -2.5 ? " below you" : ""}`;
        return <g key={threat.key} transform={`translate(${origin.x} ${origin.y}) rotate(${heading})`} opacity={strength} className={styles.threat} data-threat={threat.kind} aria-label={label}>
          <title>{label}</title>
          <path key={threat.at} d={`M0-4.5L${-width}-30A30 30 0 0 1 ${width}-30Z`} fill="url(#minimap-threat)" className={styles.threatCone} />
          <path d="M-2.4-29.5 0-33.5 2.4-29.5" className={styles.threatTip} />
          {Math.abs(height) > 2.5 && <path d={height > 0 ? "m-1.6-21 1.6-1.8 1.6 1.8" : "m-1.6-22.8 1.6 1.8 1.6-1.8"} className={styles.threatTip} />}
        </g>;
      })}
      {ordered.map((player) => {
        const point = mapPoint(player.x, player.z, half);
        const above = localY !== undefined && player.y - localY > 2.5;
        const below = localY !== undefined && localY - player.y > 2.5;
        const label = `${player.relation === "self" ? "You" : player.relation === "ally" ? "Teammate" : "Enemy"}: ${player.name}${above ? " · above you" : below ? " · below you" : ""}`;
        const color = player.relation === "ally" && player.slot !== undefined ? SQUAD_COLORS[player.slot] : undefined;
        return <g key={player.id} transform={`translate(${point.x} ${point.y})`} className={styles[player.relation]} style={color ? { fill: color } : undefined} data-player-id={player.id} data-relation={player.relation} aria-label={label}>
          <title>{label}</title>
          {player.relation === "self" ? <><circle r="4.8" className={styles.selfRing} /><path d="M0-3.8 2.7 2.8 0 1.5-2.7 2.8Z" transform={`rotate(${mapHeading(player.yaw)})`} /></> : <>
            <circle r="2.2" />
            {player.slot !== undefined && <text y=".95" className={styles.slot}>{player.slot + 1}</text>}
            {above && <path d="m-1.5-3.2 1.5-1.4L1.5-3.2" className={styles.height} />}
            {below && <path d="m-1.5 3.2 1.5 1.4L1.5 3.2" className={styles.height} />}
          </>}
        </g>;
      })}
    </svg>
    <div className={styles.legend}><span><i className={styles.selfKey} />YOU</span><span><i className={styles.allyKey} />SQUAD</span><span><i className={styles.threatKey} />HIT FROM</span></div>
  </section>;
});
