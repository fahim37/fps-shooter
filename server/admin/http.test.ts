import { describe, expect, it } from "vitest";
import { createAdminApi, originAllowed, type AdminRequest } from "./http";
import { adminConfigFromEnv, hashPassword, LoginLimiter } from "./auth";
import { MemoryStore } from "../analytics/store";
import type { LiveSnapshot, StorageStatus } from "../../game/shared/adminApi";

const USER = "owner@example.test";
const PASS = "fake-password-for-tests";

const live: LiveSnapshot = { now: 0, players: [], rooms: [], storage: "connected", peakSinceStart: { players: 0, at: 0 }, serverStartedAt: 0 };

async function setup(storage: StorageStatus = "connected") {
  const config = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD_HASH: await hashPassword(PASS) });
  const store = new MemoryStore();
  const api = createAdminApi({ config, store: () => store, storage: () => storage, live: () => live, limiter: new LoginLimiter(5, 60_000, 100) });
  const req = (method: string, path: string, init: Partial<AdminRequest> = {}): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> =>
    api.handle({ method, path, query: new URLSearchParams(), headers: {}, body: undefined, ip: "198.51.100.7", secure: true, ...init });
  const login = async (username = USER, password = PASS) => req("POST", "/login", { body: { username, password } });
  return { store, req, login };
}

const cookieOf = (res: { headers?: Record<string, string> }) => ({ cookie: res.headers!["Set-Cookie"].split(";")[0] });

describe("admin API", () => {
  it("returns 503 everywhere while admin credentials are not configured", async () => {
    const api = createAdminApi({ config: adminConfigFromEnv({}), store: () => null, storage: () => "disabled", live: () => live });
    for (const [m, p] of [["GET", "/status"], ["POST", "/login"], ["GET", "/live"], ["GET", "/players"]]) {
      const res = await api.handle({ method: m, path: p, query: new URLSearchParams(), headers: {}, body: { username: "", password: "" }, ip: "", secure: false });
      expect(res.status, p).toBe(503);
    }
  });

  it("never serves data without a valid session", async () => {
    const { req } = await setup();
    for (const p of ["/live", "/overview", "/players", "/players/abc12345", "/matches", "/matches/x", "/analytics"]) {
      expect((await req("GET", p)).status, p).toBe(401);
    }
    expect((await req("GET", "/live", { headers: { cookie: "hm_admin=forged.token" } })).status).toBe(401);
    expect(await req("GET", "/status")).toMatchObject({ status: 200, body: { enabled: true, authenticated: false } });
  });

  it("signs in with email + password and issues a secure session cookie", async () => {
    const { req, login } = await setup();
    expect((await login(USER, "wrong")).status).toBe(401);
    expect((await login("someone@example.test", PASS)).body).toEqual((await login(USER, "wrong")).body); // one generic message
    expect((await req("POST", "/login", { body: { username: USER } })).status).toBe(400);
    const ok = await login(` ${USER.toUpperCase()}`, PASS);
    expect(ok.status).toBe(200);
    expect(ok.headers!["Set-Cookie"]).toMatch(/^hm_admin=[^;]+; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
    const headers = cookieOf(ok);
    expect(await req("GET", "/status", { headers })).toMatchObject({ status: 200, body: { authenticated: true, user: USER } });
    expect((await req("GET", "/live", { headers })).body).toEqual(live);
    expect(await req("GET", "/players", { headers })).toMatchObject({ status: 200, body: { items: [], total: 0 } });
    expect((await req("GET", "/players/unknown-player", { headers })).status).toBe(404);
    expect((await req("DELETE", "/players", { headers })).status).toBe(405);

    // Logging out revokes the token even though it is still within its lifetime.
    const out = await req("POST", "/logout", { headers });
    expect(out.headers!["Set-Cookie"]).toContain("Max-Age=0");
    expect((await req("GET", "/live", { headers })).status).toBe(401);
  });

  it("rate-limits repeated failures per address", async () => {
    const { login, req } = await setup();
    for (let i = 0; i < 5; i++) expect((await login(USER, `bad${i}`)).status).toBe(401);
    const limited = await login(USER, PASS);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers!["Retry-After"])).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await req("POST", "/login", { body: { username: USER, password: PASS }, ip: "203.0.113.50" })).status).toBe(200);
  });

  it("answers 503 for stored data while the database is down, but live data keeps working", async () => {
    const { req, login } = await setup("unavailable");
    const headers = cookieOf(await login());
    expect((await req("GET", "/overview", { headers })).status).toBe(503);
    expect((await req("GET", "/live", { headers })).status).toBe(200);
  });

  it("allows cookies cross-origin only for the same host in development or configured origins", () => {
    const dev = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: PASS });
    const prod = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: PASS, NODE_ENV: "production", ADMIN_ALLOWED_ORIGINS: "https://ops.example.test" });
    expect(originAllowed("https://fahimstack.example", "fahimstack.example", prod)).toBe(true);
    expect(originAllowed("https://evil.example", "fahimstack.example", prod)).toBe(false);
    expect(originAllowed("https://ops.example.test", "fahimstack.example", prod)).toBe(true);
    expect(originAllowed("http://localhost:3000", "localhost:2567", prod)).toBe(false);
    expect(originAllowed("http://localhost:3000", "localhost:2567", dev)).toBe(true);
    expect(originAllowed("http://evil.example:3000", "localhost:2567", dev)).toBe(false);
    expect(originAllowed("null", "localhost:2567", dev)).toBe(false);
  });
});
