import { useEffect, type RefObject } from "react";
import { sightMotion } from "./core/sightMotion";

/**
 * Moves an optic layer with the gun every frame by writing its transform
 * directly: the HUD only re-renders at 20 Hz, and a composited transform
 * never repaints. `travel` scales the motion (1 = the element's own size).
 */
export function useSightMotion(ref: RefObject<HTMLElement | null>, travel: number, kickScale = 0) {
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const { x, y, kick } = sightMotion;
        el.style.transform = `translate3d(${(x * travel * 100).toFixed(2)}%, ${(y * travel * 100).toFixed(2)}%, 0) scale(${(1 + kick * kickScale).toFixed(4)})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref, travel, kickScale]);
}
