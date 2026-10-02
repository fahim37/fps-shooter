import { describe, expect, it } from "vitest";
import { RenderMotion } from "./motion";

const STEP = 1 / 120;

describe("rendered movement", () => {
  it.each([30, 60, 90, 144, 240])("moves evenly at %i FPS without changing physics", (fps) => {
    const motion = new RenderMotion();
    const physics = { x: 0, y: 0, z: 0 };
    motion.reset(physics);
    let remainder = 0;
    for (let frame = 1; frame <= fps * 2; frame++) {
      remainder += 1 / fps;
      while (remainder >= STEP) {
        motion.beforeStep(physics);
        physics.x += 6 * STEP;
        remainder -= STEP;
      }
      const physicalX = physics.x;
      motion.sample(physics, remainder / STEP);
      expect(motion.position.x).toBeCloseTo(6 * Math.max(0, frame / fps - STEP), 8);
      expect(physics.x).toBe(physicalX);
      expect(motion.position.x).toBeLessThanOrEqual(physics.x);
    }
  });

  it("stops at collision and immediately resets on respawn or correction", () => {
    const motion = new RenderMotion();
    motion.reset({ x: 0, y: 0, z: 0 });
    motion.beforeStep({ x: 1, y: 2, z: 3 });
    const wall = { x: 1.02, y: 2, z: 3 };
    motion.sample(wall, 2);
    expect(motion.position.toArray()).toEqual([1.02, 2, 3]);
    motion.beforeStep(wall);
    motion.sample(wall, 0.5);
    expect(motion.position.toArray()).toEqual([1.02, 2, 3]);
    const spawn = { x: -40, y: 1, z: 20 };
    motion.reset(spawn);
    motion.sample(spawn, 0.1);
    expect(motion.position.toArray()).toEqual([-40, 1, 20]);
  });
});
