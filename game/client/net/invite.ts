const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Accept a typed code or a complete invite pasted from another player (/CODE or ?room=CODE). */
export function parseRoomCode(value: string): string {
  const raw = value.trim();
  try {
    const url = new URL(raw);
    const query = url.searchParams.get("room");
    if (query) return normalize(query);
    const path = url.pathname.slice(BASE.length).replace(/^\/+|\/+$/g, "");
    return path.includes("/") ? "" : normalize(path);
  } catch { return normalize(raw); }
}

function normalize(value: string) {
  const code = value.trim().toUpperCase();
  // The server's code alphabet (CODE_CHARS) leaves out I, L, O, 0 and 1.
  return /^[A-HJKMNP-Z2-9]{5}$/.test(code) ? code : "";
}

/** The short invite for a room: the site's address followed by the code. */
export function inviteUrl(code: string, currentUrl: string) {
  return new URL(`${BASE}/${code}`, currentUrl).toString();
}

/** The lobby's own address, with any invite taken off it. */
export function lobbyUrl(currentUrl: string) {
  return new URL(`${BASE}/`, currentUrl).toString();
}
