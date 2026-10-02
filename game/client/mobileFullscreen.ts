type FullscreenDocument = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void | Promise<void> };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> };

export function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement ?? null;
}

/** Call directly from a user gesture; unsupported devices keep the viewport layout. */
export async function enterMobileFullscreen(element: HTMLElement): Promise<string> {
  try {
    if (!fullscreenElement()) {
      if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: "hide" });
      else if ((element as FullscreenElement).webkitRequestFullscreen) await (element as FullscreenElement).webkitRequestFullscreen!();
      else return "Fullscreen is unavailable in this browser. Try adding the game to your home screen.";
    }
  } catch {
    return "Fullscreen was blocked. Tap Fullscreen to try again.";
  }
  // Orientation locking is optional and may require fullscreen on mobile browsers.
  try { await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape"); }
  catch { return "Fullscreen enabled. Rotate your phone to landscape; rotation lock is unavailable."; }
  return "";
}

export async function exitMobileFullscreen(): Promise<void> {
  try {
    screen.orientation?.unlock?.();
    if (document.exitFullscreen && fullscreenElement()) await document.exitFullscreen();
    else if (fullscreenElement()) await (document as FullscreenDocument).webkitExitFullscreen?.();
  } catch { /* The browser may already have exited fullscreen. */ }
}
