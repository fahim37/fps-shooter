import { memo, useId, useRef } from "react";
import { useSightMotion } from "./useSightMotion";
import styles from "./RedDotSight.module.css";

/**
 * Enclosed-emitter reflex sight seen from behind. The housing rides with the
 * gun's sway while the dot, projected at infinity, stays on the aim point.
 */
export const RedDotSight = memo(function RedDotSight({ enemy, ads }: { enemy: boolean; ads: number }) {
  const id = useId().replace(/:/g, "");
  const housing = useRef<HTMLDivElement>(null);
  useSightMotion(housing, 0.9, 0.035);
  return <div aria-label={enemy ? "Enemy in sights" : "Red dot sight"}
    className={`crosshair aiming red-dot-sight ${styles.sight} ${enemy ? `enemy-sighted ${styles.target}` : ""}`}
    style={{ opacity: Math.min(1, (ads - 0.5) / 0.3) }}>
    <div ref={housing} className={styles.housing}>
      <svg className={styles.frame} viewBox="0 0 260 220" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="0.35" y2="1">
            <stop stopColor="#3b4446" /><stop offset="0.3" stopColor="#1d2426" /><stop offset="1" stopColor="#0d1214" />
          </linearGradient>
          <linearGradient id={`${id}-hood`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#56605f" /><stop offset="1" stopColor="#1b2123" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0.25" y2="1">
            <stop stopColor="#ffb35c" stopOpacity="0.16" /><stop offset="0.3" stopColor="#5fd0d8" stopOpacity="0.05" />
            <stop offset="0.7" stopColor="#5fd0d8" stopOpacity="0" /><stop offset="1" stopColor="#4bb7ff" stopOpacity="0.11" />
          </linearGradient>
          <linearGradient id={`${id}-glare`} x1="0" y1="0" x2="1" y2="0.6">
            <stop stopColor="#ffffff" stopOpacity="0" /><stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-window`}><rect x="60" y="56" width="140" height="108" rx="14" /></clipPath>
        </defs>
        {/* Brightness buttons and windage cap on the sides. */}
        <rect x="34" y="80" width="14" height="20" rx="4" fill="#161c1e" stroke="#060a0b" strokeWidth="1.5" />
        <rect x="34" y="106" width="14" height="20" rx="4" fill="#161c1e" stroke="#060a0b" strokeWidth="1.5" />
        <path d="M39 85v10 M39 111v10" stroke="#7d898b" strokeOpacity="0.5" strokeWidth="1.2" />
        <rect x="212" y="94" width="16" height="30" rx="6" fill="#1a2022" stroke="#060a0b" strokeWidth="1.5" />
        <path d="M216 102h8 M216 109h8 M216 116h8" stroke="#768284" strokeOpacity="0.45" />
        {/* Mount and rail clamp. */}
        <path d="M66 172H194L204 194H56Z" fill={`url(#${id}-shell)`} stroke="#070b0c" strokeWidth="1.5" />
        <rect x="44" y="194" width="172" height="14" rx="2" fill="#141a1c" stroke="#05090a" strokeWidth="1.5" />
        <path d="M50 199H210 M84 180H176" stroke="#7a8689" strokeOpacity="0.35" />
        <circle cx="58" cy="201" r="3" fill="#0a0f10" stroke="#606c70" /><circle cx="202" cy="201" r="3" fill="#0a0f10" stroke="#606c70" />
        {/* Shell with the sight window cut out. */}
        <path fillRule="evenodd" fill={`url(#${id}-shell)`} stroke="#060a0b" strokeWidth="1.6"
          d="M68 40H192Q214 40 214 62V156Q214 176 194 176H66Q46 176 46 156V62Q46 40 68 40Z M74 56H186Q200 56 200 70V150Q200 164 186 164H74Q60 164 60 150V70Q60 56 74 56Z" />
        <path d="M70 40H190Q208 40 212 52H48Q52 40 70 40Z" fill={`url(#${id}-hood)`} />
        <path d="M54 47Q58 42.5 70 42.5H190Q202 42.5 206 47" fill="none" stroke="#c3cfd1" strokeOpacity="0.35" />
        <path d="M50 164Q53 173 66 174H194Q207 173 210 164" fill="none" stroke="#9aa6a9" strokeOpacity="0.18" />
        {/* Window: coated glass, inner bevel, front emitter and a glare streak. */}
        <g clipPath={`url(#${id}-window)`}>
          <rect x="60" y="56" width="140" height="108" fill={`url(#${id}-glass)`} />
          <path d="M70 56L116 56L78 164H60Z" fill={`url(#${id}-glare)`} />
          <rect x="113" y="155" width="34" height="11" rx="4" fill="#0b1012" stroke="#2c3538" />
          <circle cx="130" cy="158" r="1.8" fill="#2a0806" />
        </g>
        <rect x="60.75" y="56.75" width="138.5" height="106.5" rx="13.5" fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="1.5" />
        <path d="M74 58.5H186Q197.5 58.5 197.5 70" fill="none" stroke="#a9eef3" strokeOpacity="0.28" />
      </svg>
    </div>
    <div className={styles.dot} aria-hidden="true" />
  </div>;
});
