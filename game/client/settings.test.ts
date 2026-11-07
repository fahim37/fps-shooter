import { describe, expect, it } from "vitest";
import { sanitizeSettings } from "./settings";

describe("stored graphics settings", () => {
  it("preserves valid quality preferences and adaptive resolution", () => {
    expect(sanitizeSettings({ quality: "high", qualityDefaults: 2, adaptiveResolution: false, clearView: false })).toEqual({ quality: "high", adaptiveResolution: false, clearView: false });
  });
  it("drops a quality saved under an older default so players start on Low once", () => {
    expect(sanitizeSettings({ quality: "high", name: "Ana" })).toEqual({ name: "Ana" });
  });
  it("drops a toggle peek value saved under the old default so it turns on once", () => {
    expect(sanitizeSettings({ leanToggle: false, name: "Ana" })).toEqual({ name: "Ana" });
  });
  it("keeps toggle peek off once a player has turned it off under the new default", () => {
    expect(sanitizeSettings({ leanToggle: false, leanDefaults: 1 })).toEqual({ leanToggle: false });
  });
  it("ignores invalid qualities, unexpected fields and invalid numeric values", () => {
    expect(sanitizeSettings({ quality: "broken", adaptiveResolution: "false", clearView: "false", volume: NaN, set: "bad" })).toEqual({});
    expect(sanitizeSettings(null)).toEqual({});
    expect(sanitizeSettings([])).toEqual({});
  });
  it("keeps persisted aim and rendering options inside supported ranges", () => {
    expect(sanitizeSettings({ fov: 250, sensitivity: -1, adsSensitivity: 0, volume: 5 })).toEqual({ fov: 110, sensitivity: 0.2, adsSensitivity: 0.2, volume: 1 });
  });
});
