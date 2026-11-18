import { assetUrl } from "./assets/url";

// Row-major order of the 4 by 4 PNG sprite sheet.
const icons = [
  "fire", "ads", "jump", "crouch",
  "sprint", "reload", "switch", "peekLeft",
  "peekRight", "grenade", "camera", "emote",
  "scores", "menu", "more", "layout",
] as const;

export type TouchIconName = typeof icons[number];
const sheet = `url("${assetUrl("/ui/touch-controls.png")}")`;

export function TouchIcon({ name }: { name: TouchIconName }) {
  const index = icons.indexOf(name);
  const position = `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 100 / 3}%`;
  return <i aria-hidden="true" data-touch-icon="" style={{
    display: "block", pointerEvents: "none", backgroundColor: "currentColor",
    maskImage: sheet, maskSize: "400% 400%", maskPosition: position, maskRepeat: "no-repeat",
    WebkitMaskImage: sheet, WebkitMaskSize: "400% 400%", WebkitMaskPosition: position, WebkitMaskRepeat: "no-repeat",
  }} />;
}
