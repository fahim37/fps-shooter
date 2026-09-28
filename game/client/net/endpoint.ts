/**
 * Game server address. Defaults to port 2567 on the host that served the page, which makes
 * LAN play work out of the box (friends open http://<your-ip>:3000). Set
 * NEXT_PUBLIC_GAME_SERVER_URL (e.g. wss://game.example.com) when the server is hosted elsewhere.
 */
export function gameServerUrl(): string {
  const env = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window === "undefined") return "ws://localhost:2567";
  const secure = window.location.protocol === "https:";
  const base = process.env.NEXT_PUBLIC_BASE_PATH;
  if (base) return `${secure ? "wss" : "ws"}://${window.location.host}${base}/server`;
  return `${secure ? "wss" : "ws"}://${window.location.hostname}:2567`;
}

export function gameServerHttp(): string {
  return gameServerUrl().replace(/^ws/, "http");
}
