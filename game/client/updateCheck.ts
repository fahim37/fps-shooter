import { useEffect } from "react";
import { assetUrl } from "./assets/url";

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const CHECK_MS = 60_000;
/** The build this tab last reloaded for, so a stale response can never cause a reload loop. */
const RELOADED_KEY = "hollowmere.reloadedFor";

/** Reload only for a real, different build, and only once for each one. */
export function shouldReload(running: string, served: unknown, reloadedFor: string | null) {
  return !!running && typeof served === "string" && !!served && served !== running && served !== reloadedFor;
}

function readReloaded() {
  try { return sessionStorage.getItem(RELOADED_KEY); } catch { return null; }
}

/**
 * Moves an open tab onto a new deploy. It only runs while `idle` (the main lobby, nothing open),
 * so a match is never interrupted and costs nothing; returning to the lobby checks straight away.
 */
export function useUpdateCheck(idle: boolean) {
  useEffect(() => {
    if (!idle || process.env.NODE_ENV !== "production") return;
    let live = true;
    const check = async () => {
      try {
        const res = await fetch(assetUrl("/version"), { cache: "no-store" });
        if (!res.ok) return;
        const { build } = await res.json() as { build?: unknown };
        if (!live || !shouldReload(BUILD, build, readReloaded())) return;
        try { sessionStorage.setItem(RELOADED_KEY, String(build)); } catch { return; }
        window.location.reload();
      } catch {
        /* offline or mid-restart: the next check tries again */
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    void check();
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [idle]);
}
