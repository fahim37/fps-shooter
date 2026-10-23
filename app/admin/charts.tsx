"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./admin.module.css";

export interface Point { label: string; value: number }

/** Container width in CSS pixels, tracked so charts redraw crisply at every size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean axis maximum and 3 ticks. */
function niceScale(max: number) {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw)!;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { top, ticks };
}

const PAD = { t: 14, r: 12, b: 24, l: 40 };

interface ChartProps {
  data: Point[];
  format: (v: number) => string;
  /** Axis ticks can use a shorter format than tooltips. */
  tickFormat?: (v: number) => string;
  height?: number;
  title: string;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return <div className={s.tooltip} style={{ left, top: y }} role="status">{children}</div>;
}

/** Hidden table so every chart value is reachable without hovering. */
function DataTable({ data, format, title }: Pick<ChartProps, "data" | "format" | "title">) {
  return (
    <table className={s.srOnly}>
      <caption>{title}</caption>
      <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{format(d.value)}</td></tr>)}</tbody>
    </table>
  );
}

function xLabels(n: number, width: number) {
  const want = Math.max(2, Math.min(n, Math.floor(width / 70)));
  const idx = new Set<number>();
  for (let i = 0; i < want; i++) idx.add(Math.round((i * (n - 1)) / Math.max(1, want - 1)));
  return idx;
}

/** Single-series area/line over time with a snapping crosshair. */
export function LineChart({ data, format, tickFormat = format, height = 180, title }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(width, 120), h = height;
  const max = Math.max(0, ...data.map((d) => d.value));
  const { top, ticks } = niceScale(max);
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (data.length <= 1 ? iw / 2 : (i * iw) / (data.length - 1));
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const area = data.length ? `${line}L${x(data.length - 1).toFixed(1)},${PAD.t + ih}L${x(0).toFixed(1)},${PAD.t + ih}Z` : "";
  const labels = xLabels(data.length, iw);
  const last = data.length - 1;
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * last);
    setHover(Math.max(0, Math.min(last, i)));
  };
  return (
    <div ref={ref} className={s.chart} style={{ height }}>
      {width > 0 && data.length > 0 && (
        <svg width={w} height={h} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className={s.grid} />
              <text x={PAD.l - 8} y={y(t)} className={s.tick} textAnchor="end" dominantBaseline="middle">{tickFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => labels.has(i) && (
            <text key={d.label} x={x(i)} y={h - 6} className={s.tick} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>{d.label}</text>
          ))}
          <path d={area} className={s.area} />
          <path d={line} className={s.line} />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className={s.crosshair} />}
          <circle cx={x(hover ?? last)} cy={y(data[hover ?? last].value)} r={4.5} className={s.dot} />
          <rect x={PAD.l} y={0} width={iw} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerDown={onMove} />
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} y={y(data[hover].value) - 12} width={w}><b>{format(data[hover].value)}</b><span>{data[hover].label}</span></Tooltip>
      )}
      <DataTable data={data} format={format} title={title} />
    </div>
  );
}

/** Single-series columns (one per day / category) with per-bar hover. */
export function ColumnChart({ data, format, tickFormat = format, height = 180, title }: ChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(width, 120), h = height;
  const { top, ticks } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const band = iw / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const labels = xLabels(data.length, iw);
  return (
    <div ref={ref} className={s.chart} style={{ height }}>
      {width > 0 && (
        <svg width={w} height={h} role="img" aria-label={title} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} className={s.grid} />
              <text x={PAD.l - 8} y={y(t)} className={s.tick} textAnchor="end" dominantBaseline="middle">{tickFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.l + band * i + band / 2;
            const bh = Math.max(0, (d.value / top) * ih);
            const x0 = cx - bw / 2, base = PAD.t + ih, r = Math.min(4, bw / 2, bh);
            const path = bh > 0
              ? `M${x0},${base}V${base - bh + r}Q${x0},${base - bh} ${x0 + r},${base - bh}H${x0 + bw - r}Q${x0 + bw},${base - bh} ${x0 + bw},${base - bh + r}V${base}Z`
              : "";
            return (
              <g key={d.label}>
                {path && <path d={path} className={hover === i ? s.barHover : s.bar} />}
                {labels.has(i) && <text x={cx} y={h - 6} className={s.tick} textAnchor={i === 0 && data.length > 1 ? "start" : i === data.length - 1 && data.length > 1 ? "end" : "middle"}>{d.label}</text>}
                <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="transparent"
                  onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={PAD.l + band * hover + band / 2} y={y(data[hover].value) - 12} width={w}><b>{format(data[hover].value)}</b><span>{data[hover].label}</span></Tooltip>
      )}
      <DataTable data={data} format={format} title={title} />
    </div>
  );
}

/** Tiny trend line for a KPI tile. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(28 - (v / max) * 26).toFixed(1)}`).join(" ");
  return (
    <svg className={s.spark} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Ranked horizontal bars with the value labeled at each bar's end. */
export function BarList({ rows, format, empty = "No data yet" }: { rows: { key: string; label: ReactNode; value: number; sub?: string }[]; format: (v: number) => string; empty?: string }) {
  if (!rows.length) return <p className={s.empty}>{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={s.barList}>
      {rows.map((r) => (
        <li key={r.key} title={r.sub}>
          <span className={s.barLabel}>{r.label}</span>
          <span className={s.barTrack}><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className={s.barValue}>{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day-of-week × hour grid, one hue light → strong by count. */
export function Heatmap({ grid, unit = "sessions" }: { grid: number[][]; unit?: string }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...grid.flat());
  // Monday first reads more naturally for a week.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className={s.heatWrap}>
      <div className={s.heat} role="table" aria-label={`Activity by weekday and hour (${unit})`} onPointerLeave={() => setHover(null)}>
        {order.map((d) => (
          <div key={d} className={s.heatRow} role="row">
            <span className={s.heatDay} role="rowheader">{DAYS[d]}</span>
            {grid[d].map((v, h) => (
              <span key={h} role="cell" tabIndex={-1} aria-label={`${DAYS[d]} ${h}:00, ${v} ${unit}`}
                className={hover && hover[0] === d && hover[1] === h ? s.heatCellOn : s.heatCell}
                style={{ background: v ? `color-mix(in oklab, var(--viz-1) ${Math.round(12 + (v / max) * 88)}%, var(--viz-surface))` : undefined }}
                onPointerEnter={() => setHover([d, h])} onPointerDown={() => setHover([d, h])} />
            ))}
          </div>
        ))}
        <div className={s.heatRow} aria-hidden>
          <span className={s.heatDay} />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className={s.heatHour}>{h % 6 === 0 ? `${h}h` : ""}</span>)}
        </div>
      </div>
      <p className={s.heatReadout} aria-live="polite">
        {hover ? <><b>{grid[hover[0]][hover[1]]} {unit}</b> {DAYS[hover[0]]} {String(hover[1]).padStart(2, "0")}:00–{String(hover[1] + 1).padStart(2, "0")}:00</> : <>Hover or tap a cell · darker = busier · your local time</>}
      </p>
    </div>
  );
}
