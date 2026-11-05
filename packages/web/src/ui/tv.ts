import { canFullscreen, HOME_SCREEN_TIP, isFullscreen, isInstalledApp, onFullscreenChange, toggleFullscreen } from "./fullscreen.js";

/**
 * TV mode: for a screen on the office wall. Used automatically for TV codes
 * (viewer role), or with `?tv` in the URL. No buttons, bigger name tags, the
 * office always fitted to the screen, the mouse hidden when idle, and the
 * screen kept awake.
 *
 * Moving the mouse or touching the screen shows a small bar for a few seconds:
 * a Fullscreen button (iPads included), and the way out — a TV can log in as a
 * person (handy when a TV code was opened in your own browser), a person can
 * leave TV mode.
 */
export function startTvMode(fit: () => void, role: "admin" | "member" | "viewer"): void {
  document.body.classList.add("tv");
  const exit = document.createElement("div");
  exit.className = "tv-exit";
  const fsButton = canFullscreen() && !isInstalledApp() ? `<button type="button" class="tv-fs">⛶ Fullscreen</button>` : "";
  const tip = !canFullscreen() && !isInstalledApp() ? `<span class="muted">${HOME_SCREEN_TIP}</span>` : "";
  exit.innerHTML =
    role === "viewer"
      ? `<span>📺 This browser is logged in as a TV (watch only).</span>${fsButton}${tip}
         <form method="post" action="/logout"><button type="submit">Log in as yourself</button></form>`
      : `<span>📺 TV mode</span>${fsButton}${tip}<a href="/">Exit TV mode</a>`;
  document.body.append(exit);
  const fs = exit.querySelector<HTMLButtonElement>(".tv-fs");
  if (fs) {
    fs.onclick = () => void toggleFullscreen();
    onFullscreenChange(() => (fs.textContent = isFullscreen() ? "⛶ Exit fullscreen" : "⛶ Fullscreen"));
  }
  localStorage.setItem("po.helpSeen", "1");
  document.getElementById("help")?.classList.remove("open");

  // Keep the whole office on screen, even as it grows.
  const refit = () => requestAnimationFrame(fit);
  window.addEventListener("resize", refit);
  setInterval(refit, 15_000);
  refit();

  // Hide the mouse after a few seconds without movement.
  let idle: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    document.body.classList.remove("tv-idle");
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add("tv-idle"), 4000);
  };
  window.addEventListener("mousemove", wake);
  // iPads have no mouse: a touch shows the bar too.
  window.addEventListener("touchstart", wake, { passive: true });
  window.addEventListener("pointerdown", wake);
  wake();

  keepAwake();
}

/**
 * Keep the screen from going to sleep.
 *
 * The proper way is the Screen Wake Lock API — but browsers only allow it on
 * https pages, and an office server on the local network is usually plain http
 * (e.g. http://192.168.0.3:8790). iPads and phones then dim and lock after a
 * minute. The fallback is the classic trick: an invisible, silent, 2-second
 * video playing on a loop, which the device treats as "something is happening".
 * If the browser won't start it on its own, a "Tap to keep this screen on"
 * button asks for one tap.
 */
function keepAwake(): void {
  type WakeLockNav = Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
  const nav = navigator as WakeLockNav;
  if (window.isSecureContext && nav.wakeLock) {
    const lock = () => nav.wakeLock!.request("screen").catch(() => videoFallback());
    void lock();
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void lock());
    return;
  }
  videoFallback();
}

let video: HTMLVideoElement | undefined;

function videoFallback(): void {
  if (video) return;
  video = document.createElement("video");
  video.src = "/keepawake.mp4";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.className = "keep-awake";
  document.body.append(video);

  const play = () => video!.play();
  play().catch(() => askForTap());
  // Browsers pause background media; start again when the page is shown.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void play().catch(() => askForTap()));
}

function askForTap(): void {
  if (document.querySelector(".tap-awake")) return;
  const b = document.createElement("button");
  b.className = "tap-awake";
  b.textContent = "Tap to keep this screen on";
  b.onclick = () => {
    void video?.play();
    b.remove();
  };
  document.body.append(b);
}
