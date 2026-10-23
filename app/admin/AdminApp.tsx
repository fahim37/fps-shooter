"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AdminStatus, LiveSnapshot, OverviewStats, Wire } from "@/game/shared/adminApi";
import s from "./admin.module.css";
import { ApiError, api, post, viewerTimeZone } from "./api";
import { Notice, useLoad } from "./ui";
import { KpiRow, LiveView } from "./LiveView";
import { PlayerDrawer, PlayersView } from "./PlayersView";
import { MatchDrawer, MatchesView } from "./MatchesView";
import { InsightsView } from "./InsightsView";

type Tab = "live" | "players" | "matches" | "insights";
const TABS: { id: Tab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "players", label: "Players" },
  { id: "matches", label: "Matches" },
  { id: "insights", label: "Insights" },
];
type Panel = { kind: "player"; id: string } | { kind: "match"; id: string } | null;

const storageText: Record<string, string> = {
  connected: "Database connected",
  connecting: "Connecting to the database…",
  unavailable: "Database unreachable — live data still works, history is buffered",
  disabled: "Recording disabled",
};

export default function AdminApp() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<AdminStatus>("/status").then(
      (st) => { if (alive) setStatus(st); },
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 503) setStatus({ enabled: false, authenticated: false, storage: "disabled" });
        else setBootError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => { alive = false; };
  }, []);

  const signedOut = useCallback(() => setStatus((st) => (st ? { ...st, authenticated: false } : st)), []);

  if (bootError) return <Shell><div className={s.center}><Notice tone="bad">{bootError}</Notice></div></Shell>;
  if (!status) return <Shell><div className={s.center}><p className={s.muted}>Loading…</p></div></Shell>;
  if (!status.enabled) {
    return (
      <Shell>
        <div className={s.center}>
          <div className={s.loginCard}>
            <h1>Admin is off</h1>
            <p>Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD_HASH</code> for the game server, then restart it.</p>
          </div>
        </div>
      </Shell>
    );
  }
  if (!status.authenticated) return <Shell><Login onDone={setStatus} /></Shell>;
  return <Dashboard user={status.user ?? ""} onSignedOut={signedOut} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className={s.root}>{children}</div>;
}

function Login({ onDone }: { onDone: (s: AdminStatus) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      onDone(await post<AdminStatus>("/login", { username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  return (
    <div className={s.center}>
      <form className={s.loginCard} onSubmit={submit}>
        <span className={s.eyebrow}>HOLLOWMERE · ADMIN</span>
        <h1>Sign in</h1>
        <label className={s.field}>
          <span>Email</span>
          <input name="username" type="email" autoComplete="username" inputMode="email" required autoFocus spellCheck={false} />
        </label>
        <label className={s.field}>
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className={s.formError} role="alert">{error}</p>}
        <button type="submit" className={s.primary} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

function initialTab(): Tab {
  if (typeof window === "undefined") return "live";
  const h = window.location.hash.slice(1);
  return TABS.some((t) => t.id === h) ? (h as Tab) : "live";
}

function Dashboard({ user, onSignedOut }: { user: string; onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [panel, setPanel] = useState<Panel>(null);
  const [now, setNow] = useState(() => Date.now());

  const live = useLoad(() => api<LiveSnapshot>("/live"), "live", onSignedOut, 5000);
  const overview = useLoad(() => api<Wire<OverviewStats>>("/overview", { tz: viewerTimeZone }), "overview", onSignedOut, 60_000);

  // Session timers tick every second on the server's clock.
  const skew = useRef(0);
  useEffect(() => { if (live.data) skew.current = live.data.now - Date.now(); }, [live.data]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew.current), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };
  const liveIds = useMemo(() => new Set(live.data?.players.map((p) => p.pid) ?? []), [live.data]);
  const openPlayer = useCallback((id: string) => setPanel({ kind: "player", id }), []);
  const openMatch = useCallback((id: string) => setPanel({ kind: "match", id }), []);
  const close = useCallback(() => setPanel(null), []);

  async function logout() {
    try { await post("/logout", {}); } catch { /* the cookie is cleared server-side either way */ }
    onSignedOut();
  }

  const storage = live.data?.storage ?? "connecting";
  return (
    <div className={s.root}>
      <header className={s.topbar}>
        <div className={s.brand}>
          <b>HOLLOWMERE</b>
          <small>Admin</small>
        </div>
        <nav className={s.tabs} aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
              {t.label}{t.id === "live" && live.data ? <span className={s.tabCount}>{live.data.players.length}</span> : null}
            </button>
          ))}
        </nav>
        <div className={s.topTools}>
          <span className={`${s.dbState} ${storage === "connected" ? s.ok : s.warnText}`} title={storageText[storage]}>
            <i aria-hidden /> <span className={s.hideNarrow}>{storage === "connected" ? "Live" : storage === "disabled" ? "No DB" : "DB offline"}</span>
          </span>
          <span className={`${s.muted} ${s.hideNarrow}`} title="Signed in">{user}</span>
          <button type="button" className={s.ghostButton} onClick={logout}>Log out</button>
        </div>
      </header>

      <main className={s.main}>
        {storage !== "connected" && live.data && <Notice>{storageText[storage]}. History, players and insights need MongoDB.</Notice>}
        {tab === "live" && (
          <>
            <KpiRow live={live.data} overview={overview.data} />
            {overview.error && !overview.data && <Notice>{overview.error}</Notice>}
            <LiveView live={live.data} error={live.error} onPlayer={openPlayer} now={now} />
          </>
        )}
        {tab === "players" && <PlayersView onPlayer={openPlayer} onUnauthorized={onSignedOut} liveIds={liveIds} />}
        {tab === "matches" && <MatchesView onMatch={openMatch} onUnauthorized={onSignedOut} />}
        {tab === "insights" && <InsightsView onUnauthorized={onSignedOut} />}
      </main>

      {panel?.kind === "player" && <PlayerDrawer key={panel.id} pid={panel.id} online={liveIds.has(panel.id)} onClose={close} onMatch={openMatch} onUnauthorized={onSignedOut} />}
      {panel?.kind === "match" && <MatchDrawer key={panel.id} id={panel.id} onClose={close} onPlayer={openPlayer} onUnauthorized={onSignedOut} />}
    </div>
  );
}
