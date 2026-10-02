import { memo, useId } from "react";
import styles from "./RedDotSight.module.css";

export const RedDotSight = memo(function RedDotSight({ enemy, ads }: { enemy: boolean; ads: number }) {
  const id = useId();
  return <div aria-label={enemy ? "Enemy in sights" : "Red dot sight"}
    className={`crosshair aiming red-dot-sight ${styles.sight} ${enemy ? `enemy-sighted ${styles.target}` : ""}`}
    style={{ opacity: Math.min(1, (ads - 0.5) / 0.35) }}>
    <svg className={styles.frame} viewBox="0 0 240 240" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0.8" y2="1">
          <stop stopColor="#454e50" /><stop offset="0.35" stopColor="#202729" /><stop offset="1" stopColor="#111618" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#80d7e7" stopOpacity="0.035" /><stop offset="0.5" stopColor="#80d7e7" stopOpacity="0" /><stop offset="1" stopColor="#80d7e7" stopOpacity="0.065" />
        </linearGradient>
      </defs>
      <path d="M68 52H172L190 69L196 165L184 175H56L44 165L50 69Z" fill={`url(#${id}-glass)`} />
      <path d="M63 42H177L199 62L207 171L190 187H50L33 171L41 62ZM68 52L50 69L44 165L56 175H184L196 165L190 69L172 52Z"
        fill={`url(#${id}-metal)`} fillRule="evenodd" stroke="#0b1012" strokeWidth="1.5" />
      <path d="M45 64L65 46H175L195 64 M38 169L52 182H188L202 169" fill="none" stroke="#9ba9ad" strokeOpacity="0.45" strokeWidth="1" />
      <path d="M68 54H172L188 70L194 164" fill="none" stroke="#a5e7ec" strokeOpacity="0.3" />
      <path d="M66 187H174L183 207H57Z" fill={`url(#${id}-metal)`} stroke="#0b1012" strokeWidth="1.5" />
      <path d="M48 207H192V219H48Z" fill="#171e20" stroke="#070c0e" strokeWidth="1.5" />
      <path d="M53 210H187 M76 195H164" stroke="#728084" strokeOpacity="0.4" />
      <g fill="#0a1012" stroke="#667277" strokeWidth="1">
        <circle cx="58" cy="180" r="3" /><circle cx="182" cy="180" r="3" />
      </g>
      <path d="M56 180H60 M180 180H184" stroke="#899497" strokeWidth="0.8" />
    </svg>
    <div className={styles.dot} aria-hidden="true" />
  </div>;
});
