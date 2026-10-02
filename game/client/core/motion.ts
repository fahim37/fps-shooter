import { Vector3 } from "three";

type Position = { x: number; y: number; z: number };

/** Interpolate completed physics steps for rendering only; never predict through cover. */
export class RenderMotion {
  readonly position = new Vector3();
  private previous = new Vector3();

  reset(position: Position) {
    this.previous.copy(position);
    this.position.copy(position);
  }

  beforeStep(position: Position) {
    this.previous.copy(position);
  }

  sample(position: Position, alpha: number) {
    this.position.copy(this.previous).lerp(position, Math.max(0, Math.min(1, alpha)));
  }
}
