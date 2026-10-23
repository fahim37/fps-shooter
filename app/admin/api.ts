import { gameServerHttp } from "@/game/client/net/endpoint";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The admin API lives on the game server (same origin under /fps/server in production). */
export function adminApiBase() {
  return `${gameServerHttp()}/admin/api`;
}

export const viewerTimeZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
})();

export async function api<T>(path: string, params?: Record<string, string | number | undefined>, init?: RequestInit): Promise<T> {
  const url = new URL(`${adminApiBase()}${path}`, typeof window === "undefined" ? "http://localhost" : window.location.href);
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", cache: "no-store", ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  } catch {
    throw new ApiError(0, "Can't reach the game server.");
  }
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const post = <T,>(path: string, body: unknown) => api<T>(path, undefined, { method: "POST", body: JSON.stringify(body) });
