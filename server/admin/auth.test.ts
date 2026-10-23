import { describe, expect, it } from "vitest";
import {
  LoginLimiter, adminConfigFromEnv, checkCredentials, clearedCookie, hashPassword, parseCookies, safeEqual, sessionCookie,
  signSession, verifyPassword, verifySession,
} from "./auth";

// Obviously fake credentials: never real ones in tests.
const USER = "admin@example.test";
const PASS = "correct horse battery staple";

describe("password hashing", () => {
  it("round-trips scrypt hashes and rejects anything else", async () => {
    const hash = await hashPassword(PASS);
    expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword(PASS, hash)).toBe(true);
    expect(await verifyPassword(`${PASS}!`, hash)).toBe(false);
    expect(await verifyPassword(PASS, "scrypt$zz$zz")).toBe(false);
    expect(await verifyPassword(PASS, "plaintext")).toBe(false);
    expect(await hashPassword(PASS)).not.toBe(hash); // salted
  });

  it("compares strings in constant time regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("admin config and credentials", () => {
  it("is disabled until both a username and a password are configured", () => {
    expect(adminConfigFromEnv({}).enabled).toBe(false);
    expect(adminConfigFromEnv({ ADMIN_PASSWORD: PASS }).enabled).toBe(false);
    expect(adminConfigFromEnv({ ADMIN_USERNAME: USER }).enabled).toBe(false);
    expect(adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: PASS }).enabled).toBe(true);
  });

  it("prefers the hash over the plaintext fallback and checks both fields", async () => {
    const hash = await hashPassword(PASS);
    const cfg = adminConfigFromEnv({ ADMIN_USERNAME: ` ${USER.toUpperCase()} `, ADMIN_PASSWORD_HASH: hash, ADMIN_PASSWORD: "ignored-fallback" });
    expect(cfg.password).toBeNull();
    expect(await checkCredentials(cfg, USER, PASS)).toBe(true);
    expect(await checkCredentials(cfg, "Admin@Example.Test ", PASS)).toBe(true);
    expect(await checkCredentials(cfg, USER, "ignored-fallback")).toBe(false);
    expect(await checkCredentials(cfg, "other@example.test", PASS)).toBe(false);
    expect(await checkCredentials(cfg, USER, undefined)).toBe(false);

    const plain = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: PASS });
    expect(await checkCredentials(plain, USER, PASS)).toBe(true);
    expect(await checkCredentials(plain, USER, "nope")).toBe(false);
  });

  it("derives a different signing key when the credentials change, unless ADMIN_SECRET pins it", () => {
    const a = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: "one" });
    const b = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: "two" });
    expect(a.secret.equals(b.secret)).toBe(false);
    const c = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: "one", ADMIN_SECRET: "s" });
    const d = adminConfigFromEnv({ ADMIN_USERNAME: USER, ADMIN_PASSWORD: "two", ADMIN_SECRET: "s" });
    expect(c.secret.equals(d.secret)).toBe(true);
  });
});

describe("session tokens", () => {
  const secret = Buffer.alloc(32, 7);

  it("verifies its own signature and expiry", () => {
    const { token, claims } = signSession(secret, USER, 1_000, 60_000);
    expect(verifySession(secret, token, 2_000)).toEqual(claims);
    expect(verifySession(secret, token, 61_000)).toBeNull();
    expect(verifySession(Buffer.alloc(32, 8), token, 2_000)).toBeNull();
  });

  it("rejects tampered or malformed tokens", () => {
    const { token } = signSession(secret, USER, 1_000, 60_000);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: USER, iat: 0, exp: 9e15, n: "x" })).toString("base64url");
    expect(verifySession(secret, `${forged}.${sig}`, 2_000)).toBeNull();
    expect(verifySession(secret, `${body}.${sig}x`, 2_000)).toBeNull();
    expect(verifySession(secret, `${body}.${sig}.extra`, 2_000)).toBeNull();
    expect(verifySession(secret, undefined, 2_000)).toBeNull();
    expect(verifySession(secret, "", 2_000)).toBeNull();
  });
});

describe("login rate limiting", () => {
  it("locks an address out after repeated failures until the window passes", () => {
    const l = new LoginLimiter(3, 60_000, 100);
    for (let i = 0; i < 3; i++) { expect(l.retryAfter("1.2.3.4", i)).toBe(0); l.fail("1.2.3.4", i); }
    expect(l.retryAfter("1.2.3.4", 10)).toBeGreaterThan(50_000);
    expect(l.retryAfter("5.6.7.8", 10)).toBe(0);
    expect(l.retryAfter("1.2.3.4", 60_001)).toBe(0);
  });

  it("caps failures across all addresses too", () => {
    const l = new LoginLimiter(5, 60_000, 4);
    for (let i = 0; i < 4; i++) l.fail(`10.0.0.${i}`, 0);
    expect(l.retryAfter("10.0.0.99", 1)).toBeGreaterThan(0);
  });

  it("forgets an address's failures after a successful login", () => {
    const l = new LoginLimiter(2, 60_000, 100);
    l.fail("a", 0); l.succeed("a"); l.fail("a", 1);
    expect(l.retryAfter("a", 2)).toBe(0);
  });
});

describe("cookies", () => {
  it("issues HttpOnly SameSite=Strict cookies, Secure over HTTPS", () => {
    expect(sessionCookie("t", true)).toBe("hm_admin=t; HttpOnly; SameSite=Strict; Max-Age=43200; Secure");
    expect(sessionCookie("t", false)).not.toContain("Secure");
    expect(clearedCookie(false)).toContain("Max-Age=0");
    expect(parseCookies("a=1; hm_admin=abc.def ; bad; x=%E0")).toEqual({ a: "1", hm_admin: "abc.def" });
  });
});
