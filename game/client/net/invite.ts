/** Accept a typed code or a complete invite pasted from another player. */
export function parseRoomCode(value: string): string {
  const raw = value.trim();
  try {
    const url = new URL(raw);
    return normalize(url.searchParams.get("room") ?? "");
  } catch { return normalize(raw); }
}

function normalize(value: string) {
  const code = value.trim().toUpperCase();
  return /^[A-Z2-9]{5}$/.test(code) ? code : "";
}

export function inviteUrl(code: string, currentUrl: string) {
  const url = new URL(currentUrl);
  url.search = ""; url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}
