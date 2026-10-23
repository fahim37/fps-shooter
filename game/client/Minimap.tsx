import { memo, useEffect, useRef } from "react";
import { getMap, MAPS } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";
import { MINIMAP_GRID, MINIMAP_RANGE, liveView, bearingYaw, mapHeading, markStrength, threatStrength, toFrame, viewPoint } from "./core/minimap";
import { SQUAD_COLORS } from "./core/squad";
import { useHud } from "./core/hud";
import styles from "./Minimap.module.css";

/** Map layout in world meters; the minimap moves and scales it around you. */
const Terrain = memo(function Terrain({ map }: { map: MapId }) {
  // The same roads, plazas and footprints the map was built from.
  const { half, overview } = getMap(map);
  const rect = (r: { x: number; z: number; sx: number; sz: number }) => ({ x: r.x, y: r.z, width: r.sx, height: r.sz });
  const lines: string[] = [];
  for (let v = -half + MINIMAP_GRID; v < half; v += MINIMAP_GRID) lines.push(`M${v} ${-half}V${half}M${-half} ${v}H${half}`);
  return <g aria-hidden="true">
    <rect x={-half} y={-half} width={half * 2} height={half * 2} rx="1.5" className={styles.ground} />
    <path d={lines.join("")} className={styles.grid} />
    {overview.roads.map((road, index) => <rect key={index} {...rect(road)} className={styles.road} />)}
    {overview.plazas.map((plaza, index) => <rect key={index} {...rect(plaza)} rx="0.8" className={styles.plaza} />)}
    {overview.buildings.map((building, index) => <rect key={index} {...rect(building)} rx="0.3" className={styles.building} />)}
    {overview.labels.map((label) => <text key={label.text} x={label.x} y={label.z + 1.1} className={styles.plazaLabel}>{label.text}</text>)}
  </g>;
});

export const Minimap = memo(function Minimap({ now, map }: { now: number; map: MapId }) {
  const players = useHud((state) => state.mapPlayers);
  const threats = useHud((state) => state.threats);
  const marks = useHud((state) => state.mapMarks);
  const self = players.find((player) => player.relation === "self");
  // Like PUBG, the map follows you; while you are down it stays where you fell.
  const center = useRef({ x: 0, z: 0 });
  if (self) center.current = { x: self.x, z: self.z };
  const { x: cx, z: cz } = center.current;
  const scale = 45 / MINIMAP_RANGE;
  // The HUD re-renders a few times a second; between renders, shift the map and turn your arrow
  // every frame from the game's live position so it moves smoothly.
  const shift = useRef<SVGGElement>(null), arrow = useRef<SVGPathElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (liveView.alive) {
        shift.current?.setAttribute("transform", `translate(${(cx - liveView.x) * scale} ${(cz - liveView.z) * scale})`);
        arrow.current?.setAttribute("transform", `rotate(${mapHeading(liveView.yaw)})`);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cx, cz, scale]);
  const localY = self?.y;
  const others = players.filter((player) => player.relation !== "self");
  return <section className={styles.panel} aria-label="Minimap">
    <div className={styles.heading}><span>{MAPS[map].name.toUpperCase()}</span><small>GRID {MINIMAP_GRID} M</small></div>
    <svg viewBox="0 0 100 100" className={styles.map} role="img" aria-label={`${MAPS[map].name} north-up map centered on you, with your squad, enemy gunfire and footsteps, and recent hit directions`}>
      <defs>
        <linearGradient id="minimap-threat" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ff4a3d" stopOpacity=".9" /><stop offset=".55" stopColor="#ff4a3d" stopOpacity=".35" /><stop offset="1" stopColor="#ff4a3d" stopOpacity="0" /></linearGradient>
      </defs>
      <g ref={shift}>
      <g transform={`translate(${50 - cx * scale} ${50 - cz * scale}) scale(${scale})`}><Terrain map={map} /></g>
      {/* Range rings: 10 and 25 meters around you. */}
      <circle cx="50" cy="50" r={10 * scale} className={styles.ring} />
      <circle cx="50" cy="50" r={25 * scale} className={styles.ring} />
      <path d="m50 1.5-1.4 2.6h2.8Z" className={styles.northMark} /><text x="50" y="8.6" className={styles.north}>N</text>
      {marks.map((mark) => {
        const strength = markStrength(mark, now);
        if (strength <= 0) return null;
        const point = viewPoint(mark.x, mark.z, cx, cz);
        if (point.x < -4 || point.x > 104 || point.y < -4 || point.y > 104) return null;
        if (mark.kind === "shot") {
          return <g key={mark.key} transform={`translate(${point.x} ${point.y})`} opacity={strength} className={styles.shot} aria-label="Enemy gunfire">
            <circle key={mark.at} r="4.5" className={styles.shotPulse} />
            <circle r="1.9" className={styles.shotDot} />
          </g>;
        }
        // Each footprint sits a little to its side of the line of travel.
        const side = mark.left ? -0.55 : 0.55;
        return <g key={mark.key} transform={`translate(${point.x} ${point.y}) rotate(${mapHeading(mark.yaw)}) translate(${side} 0)`} opacity={strength * 0.9} className={styles.step} aria-label="Enemy footsteps">
          <path d="M0-1.5c.75 0 1 .7.95 1.4-.08.85-.38 1.1-.95 1.1S-1 .75-1-.1c-.05-.7.25-1.4 1-1.4ZM-.62 1.25h1.24l-.08.75c-.06.4-.3.55-.54.55s-.48-.15-.54-.55Z" />
        </g>;
      })}
      {self && threats.map((threat) => {
        const strength = threatStrength(threat, now);
        if (strength <= 0) return null;
        // Direction only: a fixed-length cone never reveals how far away the shooter is.
        const heading = mapHeading(bearingYaw(threat.from[0] - self.x, threat.from[2] - self.z));
        const width = threat.kind === "explosion" ? 9 : 5.5;
        const height = threat.from[1] - self.y;
        const label = `Hit from ${threat.kind === "explosion" ? "an explosion" : "gunfire"}${height > 2.5 ? " above you" : height < -2.5 ? " below you" : ""}`;
        return <g key={threat.key} transform={`translate(50 50) rotate(${heading})`} opacity={strength} className={styles.threat} data-threat={threat.kind} aria-label={label}>
          <title>{label}</title>
          <path key={threat.at} d={`M0-4.5L${-width}-30A30 30 0 0 1 ${width}-30Z`} fill="url(#minimap-threat)" className={styles.threatCone} />
          <path d="M-2.4-29.5 0-33.5 2.4-29.5" className={styles.threatTip} />
          {Math.abs(height) > 2.5 && <path d={height > 0 ? "m-1.6-21 1.6-1.8 1.6 1.8" : "m-1.6-22.8 1.6 1.8 1.6-1.8"} className={styles.threatTip} />}
        </g>;
      })}
      {others.map((player) => {
        const point = toFrame(viewPoint(player.x, player.z, cx, cz));
        const above = localY !== undefined && player.y - localY > 2.5;
        const below = localY !== undefined && localY - player.y > 2.5;
        const label = `${player.relation === "ally" ? "Teammate" : "Enemy"}: ${player.name}${above ? " · above you" : below ? " · below you" : ""}${point.edge ? " · out of range" : ""}`;
        const color = player.relation === "ally" && player.slot !== undefined ? SQUAD_COLORS[player.slot] : undefined;
        return <g key={player.id} transform={`translate(${point.x} ${point.y})`} className={styles[player.relation]} style={color ? { fill: color } : undefined} opacity={point.edge ? 0.75 : 1} data-player-id={player.id} data-relation={player.relation} aria-label={label}>
          <title>{label}</title>
          <circle r={point.edge ? 1.8 : 2.2} />
          {player.slot !== undefined && !point.edge && <text y=".95" className={styles.slot}>{player.slot + 1}</text>}
          {above && <path d="m-1.5-3.2 1.5-1.4L1.5-3.2" className={styles.height} />}
          {below && <path d="m-1.5 3.2 1.5 1.4L1.5 3.2" className={styles.height} />}
        </g>;
      })}
      </g>
      {/* Your arrow last, so it stays on top. */}
      {self && <g transform="translate(50 50)" className={styles.self} data-player-id={self.id} data-relation="self" aria-label={`You: ${self.name}`}>
        <title>{`You: ${self.name}`}</title>
        <circle r="4.8" className={styles.selfRing} /><path ref={arrow} d="M0-3.8 2.7 2.8 0 1.5-2.7 2.8Z" transform={`rotate(${mapHeading(self.yaw)})`} />
      </g>}
    </svg>
    <div className={styles.legend}><span><i className={styles.selfKey} />YOU</span><span><i className={styles.allyKey} />SQUAD</span><span><i className={styles.enemyKey} />ENEMY</span><span><i className={styles.threatKey} />HIT</span></div>
  </section>;
});
