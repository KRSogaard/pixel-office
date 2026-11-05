/**
 * Fullscreen, including iPads (Safari there only has the webkit-prefixed API;
 * iPhones have none — "Add to Home Screen" is the way there, and on iPads too
 * if you want it to stick).
 */

type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as FsDoc;

export function canFullscreen(): boolean {
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** Running as a home-screen app (already full screen, no browser bars). */
export function isInstalledApp(): boolean {
  return window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      const el = document.documentElement as FsEl;
      await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    }
  } catch {
    // refused (no user gesture, or not allowed here)
  }
}

export function onFullscreenChange(fn: () => void): void {
  document.addEventListener("fullscreenchange", fn);
  document.addEventListener("webkitfullscreenchange", fn);
}

/** What to tell people whose browser can't go fullscreen from a button (iPhones). */
export const HOME_SCREEN_TIP = "Tip: in Safari, tap Share → Add to Home Screen to open the office full screen.";
