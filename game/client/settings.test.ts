import { describe, expect, it } from "vitest";
import { sanitizeSettings } from "./settings";

describe("stored graphics settings", () => {
  it("preserves valid quality preferences and adaptive resolution", () => {
    expect(sanitizeSettings({ quality: "low", adaptiveResolution: false })).toEqual({ quality: "low", adaptiveResolution: false });
  });
  it("ignores invalid qualities, unexpected fields and invalid numeric values", () => {
    expect(sanitizeSettings({ quality: "broken", adaptiveResolution: "false", volume: NaN, set: "bad" })).toEqual({});
    expect(sanitizeSettings(null)).toEqual({});
    expect(sanitizeSettings([])).toEqual({});
  });
  it("keeps persisted aim and rendering options inside supported ranges", () => {
    expect(sanitizeSettings({ fov: 250, sensitivity: -1, adsSensitivity: 0, volume: 5 })).toEqual({ fov: 110, sensitivity: 0.2, adsSensitivity: 0.2, volume: 1 });
  });
});
