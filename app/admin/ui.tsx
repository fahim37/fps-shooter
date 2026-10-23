"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import s from "./admin.module.css";
import { ApiError } from "./api";

export interface Col<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "right";
  /** Lead cell: spans the full card width on phones. */
  lead?: boolean;
  /** Dropped from the phone card to keep it short. */
  minor?: boolean;
}

/** Desktop: a table scrolling inside its own card. Phone: each row becomes a labeled card. */
export function Table<T>({ rows, cols, rowKey, onRow, empty = "Nothing here yet", rowLabel, wide }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: string; rowLabel?: (r: T) => string;
  /** Many columns: keep a readable minimum width and scroll inside the card instead of squeezing. */
  wide?: boolean;
}) {
  if (!rows.length) return <p className={s.empty}>{empty}</p>;
  return (
    <div className={s.tableWrap}>
      <table className={wide ? `${s.table} ${s.wide}` : s.table}>
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.align === "right" ? s.right : undefined} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={onRow ? s.clickable : undefined} tabIndex={onRow ? 0 : undefined}
              aria-label={onRow && rowLabel ? rowLabel(r) : undefined}
              onClick={onRow ? () => onRow(r) : undefined}
              onKeyDown={onRow ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRow(r); } } : undefined}>
              {cols.map((c) => (
                <td key={c.key} data-label={c.label} className={[c.align === "right" ? s.right : "", c.lead ? s.lead : "", c.minor ? s.minor : ""].join(" ")}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  return (
    <nav className={s.pager} aria-label="Pages">
      <button type="button" className={s.ghostButton} disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
      <span>Page {page} of {pages}</span>
      <button type="button" className={s.ghostButton} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </nav>
  );
}

export function Card({ title, sub, action, children, className }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${s.card} ${className ?? ""}`}>
      {(title || action) && (
        <header className={s.cardHead}>
          <div>{title && <h2>{title}</h2>}{sub && <p>{sub}</p>}</div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, live, children }: { label: string; value: ReactNode; sub?: ReactNode; live?: boolean; children?: ReactNode }) {
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel}>{live && <i className={s.liveDot} aria-hidden />}{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
      {children}
    </div>
  );
}

export function Drawer({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className={s.drawerShade} onClick={onClose}>
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Details"} onClick={(e) => e.stopPropagation()}>
        <header className={s.drawerHead}>
          <div className={s.drawerTitle}>{title}{sub && <p>{sub}</p>}</div>
          <button ref={close} type="button" className={s.iconButton} onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className={s.drawerBody}>{children}</div>
      </aside>
    </div>
  );
}

export function Pill({ tone, children }: { tone?: "blue" | "red" | "good" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`${s.pill} ${tone ? s[tone] : ""}`}>{children}</span>;
}

export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "bad" }) {
  return <p className={`${s.notice} ${tone === "bad" ? s.noticeBad : ""}`} role="status">{children}</p>;
}

export function Loading() {
  return <p className={s.empty} aria-busy="true">Loading…</p>;
}

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/**
 * Fetches `load()` whenever `key` changes, optionally re-polling. Keeps the last good data while
 * reloading (no flashing). A 401 bubbles to `onUnauthorized`.
 */
export function useLoad<T>(load: (() => Promise<T>) | null, key: string, onUnauthorized: () => void, pollMs = 0): Loaded<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; loading: boolean }>({ key, data: null, error: null, loading: !!load });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  const unauthRef = useRef(onUnauthorized);
  useEffect(() => { loadRef.current = load; unauthRef.current = onUnauthorized; });
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const fn = loadRef.current;
    if (!fn) return;
    let alive = true;
    setState((prev) => ({ key, data: prev.key === key ? prev.data : null, error: null, loading: true }));
    fn().then(
      (data) => { if (alive) setState({ key, data, error: null, loading: false }); },
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) unauthRef.current();
        setState((prev) => ({ ...prev, error: e instanceof Error ? e.message : String(e), loading: false }));
      },
    );
    return () => { alive = false; };
  }, [key, tick]);

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") setTick((t) => t + 1); }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, key]);

  return { data: state.key === key ? state.data : null, error: state.error, loading: state.loading, reload };
}
