"use client";

import { MAPS, MAP_IDS } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";
import { assetUrl } from "./assets/url";
import styles from "./MapPicker.module.css";

/**
 * Map cards: the picture with the map's name on it, nothing more. Read-only (for non-hosts) when
 * `onChange` is omitted. `compact` is a thumbnail row. Map credits (CC BY) are on the help screen.
 */
export function MapPicker({ value, onChange, disabled, compact = false }: { value: MapId; onChange?: (map: MapId) => void; disabled?: boolean; compact?: boolean }) {
  return <div className={`${styles.picker} map-picker`}>
    <div className={`${styles.grid} ${compact ? styles.compact : ""}`} role="radiogroup" aria-label="Map">
      {MAP_IDS.map((id) => {
        const map = MAPS[id];
        const selected = value === id;
        return <button key={id} type="button" role="radio" aria-checked={selected} data-map={id} title={`${map.name}: ${map.tagline}`}
          className={`${styles.card} ${selected ? styles.selected : ""}`}
          disabled={disabled || (!onChange && !selected)}
          onClick={() => onChange?.(id)}>
          <span className={styles.preview} style={{ backgroundImage: `url(${assetUrl(`/maps/${id}.webp`)})` }} aria-hidden="true" />
          <strong className={styles.name}>{map.name}</strong>
        </button>;
      })}
    </div>
  </div>;
}
