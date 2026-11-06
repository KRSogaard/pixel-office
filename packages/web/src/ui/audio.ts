/**
 * The page's one audio output, open only while a sound is playing.
 *
 * An open AudioContext keeps the computer's audio output busy even when it is
 * silent, and that is enough for a Mac to pull AirPods over from an iPhone
 * that's playing an audiobook. So the context is created for a sound and
 * closed again shortly after the last one ends.
 */
let ctx: AudioContext | undefined;
let quietAt = 0;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

const LINGER_MS = 1000;

/** An audio context to schedule a sound of `seconds` on, or undefined when the browser has no audio. */
export function audioFor(seconds: number): AudioContext | undefined {
  try {
    ctx ??= new AudioContext();
  } catch {
    return undefined;
  }
  quietAt = Math.max(quietAt, performance.now() + seconds * 1000);
  scheduleClose();
  return ctx;
}

function scheduleClose(): void {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (performance.now() < quietAt) return scheduleClose();
    const done = ctx;
    ctx = undefined;
    void done?.close();
  }, Math.max(0, quietAt - performance.now()) + LINGER_MS);
}
