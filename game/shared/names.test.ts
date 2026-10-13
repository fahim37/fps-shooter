import { describe, expect, it } from "vitest";
import { NAME_MAX, randomName } from "./names";

describe("random callsigns", () => {
  it("are readable, short enough and vary", () => {
    const names = new Set(Array.from({ length: 200 }, () => randomName()));
    for (const name of names) expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+[0-9]{2}$/);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(names.size).toBeGreaterThan(150);
  });
});
