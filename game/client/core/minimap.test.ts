import { describe, expect, it } from "vitest";
import { mapHeading, mapPoint, mapRelation } from "./minimap";
import { VILLAGE_OVERVIEW } from "../../shared/map/village";

describe("minimap coordinates", () => {
  it("maps world north upward and keeps map-edge players inside the frame", () => {
    expect(mapPoint(0, 0, 46)).toEqual({ x: 50, y: 50 });
    expect(mapPoint(-46, -46, 46)).toEqual({ x: 5, y: 5 });
    expect(mapPoint(46, 46, 46)).toEqual({ x: 95, y: 95 });
    expect(mapPoint(80, -80, 46)).toEqual({ x: 95, y: 5 });
  });
  it("keeps the facing arrow aligned with the actual yaw", () => {
    expect(mapHeading(0)).toBeCloseTo(0);
    expect(mapHeading(-Math.PI / 2)).toBe(90);
    expect(mapHeading(Math.PI / 2)).toBe(-90);
  });
  it("distinguishes self, allies and enemies including free-for-all", () => {
    expect(mapRelation("me", 1, "me", 1, "tdm")).toBe("self");
    expect(mapRelation("other", 1, "me", 1, "tdm")).toBe("ally");
    expect(mapRelation("other", 2, "me", 1, "tdm")).toBe("enemy");
    expect(mapRelation("other", 0, "me", 0, "ffa")).toBe("enemy");
  });
  it("uses the village's real building footprints within the playable bounds", () => {
    expect(VILLAGE_OVERVIEW.buildings).toHaveLength(16);
    expect(VILLAGE_OVERVIEW.buildings.every(({ x, z, sx, sz }) => x >= -46 && z >= -46 && x + sx <= 46 && z + sz <= 46)).toBe(true);
  });
});
