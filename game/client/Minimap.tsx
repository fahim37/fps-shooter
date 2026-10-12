import { memo } from "react";
import { VILLAGE_OVERVIEW } from "../shared/map/village";
import { mapHeading, mapPoint } from "./core/minimap";
import { useHud } from "./core/hud";
import styles from "./Minimap.module.css";

const { half, plaza, road, buildings } = VILLAGE_OVERVIEW;
const scale = 90 / (half * 2);

const Terrain = memo(function Terrain() {
  return <g aria-hidden="true">
    <rect x="5" y="5" width="90" height="90" rx="2" className={styles.ground} />
    <path d="M20 5V95M35 5V95M50 5V95M65 5V95M80 5V95M5 20H95M5 35H95M5 50H95M5 65H95M5 80H95" className={styles.grid} />
    <path d="M5 50H95M50 5V95" className={styles.roads} strokeWidth={road * 2 * scale} />
    <rect x={50 - plaza * scale} y={50 - plaza * scale} width={plaza * 2 * scale} height={plaza * 2 * scale} rx="1" className={styles.plaza} />
    {buildings.map((building, index) => {
      const point = mapPoint(building.x, building.z, half);
      return <rect key={index} x={point.x} y={point.y} width={building.sx * scale} height={building.sz * scale} rx="0.4" className={styles.building} />;
    })}
    <path d="m50 2-1 2h2Z" fill="#d9ed79" /><text x="50" y="10" className={styles.north}>N</text>
    <text x="50" y="51.5" className={styles.plazaLabel}>PLAZA</text>
  </g>;
});

export function Minimap() {
  const players = useHud((state) => state.mapPlayers);
  const localY = players.find((player) => player.relation === "self")?.y;
  // Paint the local arrow last so it stays recognizable when players overlap.
  const ordered = [...players.filter((player) => player.relation !== "self"), ...players.filter((player) => player.relation === "self")];
  return <section className={styles.panel} aria-label="Minimap">
    <div className={styles.heading}><span>THE VILLAGE</span><small>LIVE POSITIONS</small></div>
    <svg viewBox="0 0 100 100" className={styles.map} role="img" aria-label="North-up village map with live player locations">
      <Terrain />
      {ordered.map((player) => {
        const point = mapPoint(player.x, player.z, half);
        const above = localY !== undefined && player.y - localY > 2.5;
        const below = localY !== undefined && localY - player.y > 2.5;
        const label = `${player.relation === "self" ? "You" : player.relation === "ally" ? "Teammate" : "Enemy"}: ${player.name}${above ? " · above you" : below ? " · below you" : ""}`;
        return <g key={player.id} transform={`translate(${point.x} ${point.y})`} className={styles[player.relation]} data-player-id={player.id} data-relation={player.relation} aria-label={label}>
          <title>{label}</title>
          {player.relation === "self" ? <><circle r="4.8" className={styles.selfRing} /><path d="M0-3.8 2.7 2.8 0 1.5-2.7 2.8Z" transform={`rotate(${mapHeading(player.yaw)})`} /></> : <>
            <circle r="2" />
            {above && <path d="m-1.5-3 1.5-1.4L1.5-3" className={styles.height} />}
            {below && <path d="m-1.5 3 1.5 1.4L1.5 3" className={styles.height} />}
          </>}
        </g>;
      })}
    </svg>
    <div className={styles.legend}><span><i className={styles.selfKey} />YOU</span><span><i className={styles.allyKey} />ALLY</span><span><i className={styles.enemyKey} />ENEMY</span></div>
  </section>;
}
