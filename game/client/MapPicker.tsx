"use client";

import { MAPS, MAP_IDS } from "../shared/map/maps";
import type { MapId } from "../shared/map/types";
import { assetUrl } from "./assets/url";
import styles from "./MapPicker.module.css";

/** Map cards with previews. Read-only (for non-hosts) when `onChange` is omitted. */
export function MapPicker({ value, onChange, disabled }: { value: MapId; onChange?: (map: MapId) => void; disabled?: boolean }) {
  return <div className={styles.grid} role="radiogroup" aria-label="Map">
    {MAP_IDS.map((id) => {
      const map = MAPS[id];
      const selected = value === id;
      return <button key={id} type="button" role="radio" aria-checked={selected} data-map={id}
        className={`${styles.card} ${selected ? styles.selected : ""}`}
        disabled={disabled || (!onChange && !selected)}
        onClick={() => onChange?.(id)}>
        <span className={styles.preview} style={{ backgroundImage: `url(${assetUrl(`/maps/${id}.webp`)})` }} aria-hidden="true">
          {selected && <b className={styles.badge}>SELECTED</b>}
        </span>
        <span className={styles.body}>
          <strong>{map.name}</strong>
          <small>{map.tagline}</small>
          <em>{map.style}</em>
        </span>
      </button>;
    })}
  </div>;
}
