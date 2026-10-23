const KEY = "hollowmere-player-id";
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

/** Anonymous id this browser keeps across visits, so returning players are recognized. */
export function playerId(): string | undefined {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && VALID.test(stored)) return stored;
    // randomUUID needs a secure context; LAN play over plain http only has getRandomValues.
    const c: Partial<Crypto> = globalThis.crypto ?? {};
    const id = typeof c.randomUUID === "function"
      ? c.randomUUID()
      : Array.from(c.getRandomValues!(new Uint8Array(16)), (b: number) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return undefined; // storage blocked: the server falls back to an address-based id
  }
}
