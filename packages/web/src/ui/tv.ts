/**
 * TV mode: for a screen on the office wall. Used automatically for TV codes
 * (viewer role), or with `?tv` in the URL. No buttons, bigger name tags, the
 * office always fitted to the screen, the mouse hidden when idle, and the
 * screen kept awake.
 *
 * Moving the mouse shows a small bar for a few seconds with the way out: a
 * viewer can log in as admin (handy when a TV code was opened in your own
 * browser), an admin can leave TV mode.
 */
export function startTvMode(fit: () => void, role: "admin" | "viewer"): void {
  document.body.classList.add("tv");
  const exit = document.createElement("div");
  exit.className = "tv-exit";
  exit.innerHTML =
    role === "viewer"
      ? `<span>📺 This browser is logged in as a TV (watch only).</span>
         <form method="post" action="/logout"><button type="submit">Log in as admin</button></form>`
      : `<span>📺 TV mode</span><a href="/">Exit TV mode</a>`;
  document.body.append(exit);
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
  wake();

  // Keep the screen awake (where the browser allows it).
  const lock = async () => {
    try {
      await (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } }).wakeLock?.request("screen");
    } catch {
      // not supported or not allowed; the TV's own settings will have to do
    }
  };
  void lock();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void lock());
}
