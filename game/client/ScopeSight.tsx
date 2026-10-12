import { memo, useId, useRef, type ReactNode } from "react";
import { OPTICS, type OpticId } from "../shared/optics";
import { useSightMotion } from "./useSightMotion";
import styles from "./ScopeSight.module.css";

type ScopeId = Exclude<OpticId, "iron" | "red-dot">;

/** Black reticle wire with a faint light halo so it stays readable against dark scenes. */
function Wire({ d, w }: { d: string; w: number }) {
  return <><path className={styles.halo} d={d} strokeWidth={w + 2.4} /><path className={styles.wire} d={d} strokeWidth={w} /></>;
}

function Engraving({ x, y, children, anchor = "middle" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end" }) {
  return <text className={styles.engraving} x={x} y={y} textAnchor={anchor}>{children}</text>;
}

function TwoTimes({ glow }: { glow: string }) {
  return <>
    <Wire w={9} d="M0 500H330 M670 500H1000 M500 670V1000" />
    <Wire w={2} d="M330 500H462 M538 500H670 M500 538V670 M500 330V462" />
    <g className={styles.illum} filter={`url(#${glow})`}>
      <circle cx="500" cy="500" r="4.5" />
      <circle cx="500" cy="500" r="26" fill="none" strokeWidth="2.4" />
    </g>
  </>;
}

const LADDER = [[615, 46, "4"], [665, 38, "5"], [715, 30, "6"], [765, 24, "7"], [815, 18, "8"]] as const;

/** ACOG-style: illuminated chevron with a bullet-drop ladder, as on PUBG's 4×. */
function FourTimes({ glow }: { glow: string }) {
  return <>
    <Wire w={10} d="M0 500H90 M910 500H1000 M500 880V1000" />
    <Wire w={2.2} d={`M90 500H410 M590 500H910 M500 572V880 ${[150, 250, 350, 650, 750, 850].map((x) => `M${x} 490v20`).join(" ")} ${LADDER.map(([y, w]) => `M${500 - w} ${y}h${w * 2}`).join(" ")}`} />
    {LADDER.map(([y, w, label]) => <Engraving key={label} x={500 - w - 12} y={y + 5} anchor="end">{label}</Engraving>)}
    <g className={styles.illum} filter={`url(#${glow})`}>
      <path d="M500 499L541 556H527L500 519L473 556H459Z" />
    </g>
  </>;
}

/** Long-range duplex with mil dots and a stadia rangefinder. */
function SixTimes({ glow }: { glow: string }) {
  const mils = [50, 100, 150, 200, 250];
  return <>
    <Wire w={10} d="M0 500H220 M780 500H1000 M500 0V220 M500 780V1000" />
    <Wire w={1.6} d="M220 500H490 M510 500H780 M500 220V490 M500 510V780 M240 712H404 M244 712V634 Q300 700 404 704" />
    <g className={styles.dots}>
      {mils.flatMap((m) => [[500 - m, 500], [500 + m, 500], [500, 500 - m], [500, 500 + m]]).map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4.2" />)}
    </g>
    {[[254, "2"], [298, "4"], [344, "6"], [392, "8"]].map(([x, label]) => <Engraving key={label} x={Number(x)} y={735}>{label}</Engraving>)}
    <g className={styles.illum} filter={`url(#${glow})`}>
      <circle cx="500" cy="500" r="3.4" />
      <path d="M500 478v10 M500 512v10 M478 500h10 M512 500h10" strokeWidth="2" fill="none" />
    </g>
  </>;
}

const RETICLES: Record<ScopeId, (p: { glow: string }) => ReactNode> = { "2x": TwoTimes, "4x": FourTimes, "6x": SixTimes };

export const ScopeSight = memo(function ScopeSight({ optic, enemy, ads, zoom }: { optic: OpticId; enemy: boolean; ads: number; zoom: number }) {
  const glow = useId().replace(/:/g, "");
  const eyepiece = useRef<HTMLDivElement>(null);
  useSightMotion(eyepiece, 0.37, 0.02);
  const scope: ScopeId = optic === "iron" || optic === "red-dot" ? "2x" : optic;
  const Reticle = RETICLES[scope];
  return <div aria-label={enemy ? "Enemy in scope" : OPTICS[optic].name}
    className={`scope ${styles.scope} ${styles[`x${scope[0]}`]} ${enemy ? `enemy-sighted ${styles.target}` : ""}`}
    style={{ opacity: Math.min(1, (ads - 0.68) / 0.22) }}>
    <div className={styles.surround} />
    <div className={styles.optic}>
      <svg className={styles.reticle} viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <Reticle glow={glow} />
      </svg>
      <div ref={eyepiece} className={styles.eyepiece} />
      <span className={`scope-label ${styles.label}`}>{OPTICS[optic].name.toUpperCase()}<b>{zoom.toFixed(1)}×</b></span>
    </div>
  </div>;
});
