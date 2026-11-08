/**
 * Game server address. Defaults to port 2567 on the host that served the page, which makes
 * LAN play work out of the box (friends open http://<your-ip>:3000). Set
 * NEXT_PUBLIC_GAME_SERVER_URL (e.g. wss://game.example.com) when the server is hosted elsewhere,
 * or NEXT_PUBLIC_GAME_SERVER_PATH (e.g. /server) when nginx proxies it on the page's own host.
 */
export function gameServerUrl(): string {
  const env = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window === "undefined") return "ws://localhost:2567";
  const secure = window.location.protocol === "https:";
  const base = process.env.NEXT_PUBLIC_BASE_PATH;
  const path = process.env.NEXT_PUBLIC_GAME_SERVER_PATH || (base ? `${base}/server` : "");
  if (path) return `${secure ? "wss" : "ws"}://${window.location.host}${path}`;
  return `${secure ? "wss" : "ws"}://${window.location.hostname}:2567`;
}

export function gameServerHttp(): string {
  return gameServerUrl().replace(/^ws/, "http");
}
