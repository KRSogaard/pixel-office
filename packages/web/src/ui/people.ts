import type { DisplayLink, Me as MeInfo, OfficeUser } from "@pixel-office/protocol";

/** The logged-in person, as the "Me" panel shows them. */
type Me = NonNullable<MeInfo["user"]>;

/**
 * People and TV links (admins only).
 *
 * People: everyone who sends agents to this office gets their own ingest token,
 * so their agents are labelled with their name. A token is shown once, when the
 * person is added; removing the person revokes it.
 *
 * TV codes: a 6-letter code (abc-def) for a screen in the office. Type it into
 * the "TV code" box on the login page once and that browser stays logged in as a
 * viewer (it can watch, not change anything). Removing the screen logs it out.
 *
 * Tokens and codes are stored only as hashes, so they can't be shown again —
 * "New token" / "New code" replaces one (the old one stops working).
 */
export class PeoplePanel {
  private users: OfficeUser[] = [];
  private displays: DisplayLink[] = [];
  /** Shown once after creating a person or a TV link. */
  private secret: { kind: "user" | "display"; name: string; value: string } | undefined;
  private error = "";

  constructor(private root: HTMLElement) {}

  get isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  async toggle(): Promise<void> {
    if (this.isOpen) {
      this.root.classList.remove("open");
      this.secret = undefined;
      return;
    }
    this.root.classList.add("open");
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const [u, d] = await Promise.all([api<OfficeUser[]>("GET", "/api/users"), api<DisplayLink[]>("GET", "/api/displays")]);
      this.users = u;
      this.displays = d;
      this.error = "";
    } catch (err) {
      this.error = String(err instanceof Error ? err.message : err);
    }
    this.render();
  }

  private render(): void {
    const origin = location.origin;
    const secret = this.secret
      ? this.secret.kind === "user"
        ? `
        <div class="secret">
          <b>${esc(this.secret.name)}'s token</b> — shown only now, copy it:
          <code>${esc(this.secret.value)}</code>
          <button data-copy="${esc(this.secret.value)}">Copy</button>
          <p class="muted">${esc(this.secret.name)} logs in to the office with their name and this token, and sets up Claude Code:</p>
          <pre>/plugin marketplace add KRSogaard/pixel-office
/plugin install pixel-office@pixel-office
Server URL: ${esc(origin)}
Ingest token: (the token above)</pre>
          <p class="muted">OpenCode: set PIXEL_OFFICE_URL=${esc(origin)} and PIXEL_OFFICE_TOKEN to the token.</p>
        </div>`
        : `
        <div class="secret">
          <b>TV code for ${esc(this.secret.name)}</b> — shown only now:
          <div class="tv-code">${esc(this.secret.value)}</div>
          <p class="muted">On the screen, open <b>${esc(origin)}</b> and type the code in the “TV code” box
          (or go to ${esc(origin)}/tv/${esc(this.secret.value)}). That browser then stays logged in for a year
          as a viewer. Remove the screen to log it out.</p>
        </div>`
      : "";
    const when = (t?: number) => (t ? new Date(t).toLocaleString() : "never");
    this.root.innerHTML = `
      <div class="set-head"><b>People &amp; TV screens</b><button class="set-close" title="Close">×</button></div>
      ${this.error ? `<p class="err">${esc(this.error)}</p>` : ""}
      ${secret}
      <section><span class="section-title">People</span>
        <p class="muted">Everyone gets their own token: their agents carry their name, and they log in with their name + token. Admins can also manage people, screens and settings.</p>
        <table class="people">
          ${this.users.map((u) => `<tr><td><b>${esc(u.name)}</b> <span class="role role-${u.role}">${u.role === "admin" ? "admin ★" : "member"}</span></td><td class="muted">last seen ${when(u.lastSeenAt)}</td><td><button data-role="${esc(u.id)}" data-to="${u.role === "admin" ? "member" : "admin"}" data-name="${esc(u.name)}">${u.role === "admin" ? "Make member" : "Make admin"}</button> <button data-new-user="${esc(u.id)}" data-name="${esc(u.name)}">New token</button>${u.hasPassword ? ` <button data-reset-pw="${esc(u.id)}" data-name="${esc(u.name)}" title="For a forgotten password: they log in with their token again and pick a new one">Reset password</button>` : ""} <button data-del-user="${esc(u.id)}" data-name="${esc(u.name)}">Remove</button></td></tr>`).join("") || `<tr><td class="muted">Nobody yet.</td></tr>`}
        </table>
        <form class="add" data-add="user"><input name="name" maxlength="40" placeholder="Name, e.g. Morten" required /><label class="muted"><input type="checkbox" name="admin" /> admin</label><button>Add person</button></form>
      </section>
      <section><span class="section-title">TV screens</span>
        <p class="muted">A 6-letter code that logs a screen in to watch (read-only).</p>
        <table class="people">
          ${this.displays.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td class="muted">created ${when(d.createdAt)}</td><td><button data-new-display="${esc(d.id)}" data-name="${esc(d.name)}">New code</button> <button data-del-display="${esc(d.id)}" data-name="${esc(d.name)}">Remove</button></td></tr>`).join("") || `<tr><td class="muted">No screens yet.</td></tr>`}
        </table>
        <form class="add" data-add="display"><input name="name" maxlength="40" placeholder="Screen, e.g. Kitchen TV" required /><button>Add screen</button></form>
      </section>`;

    this.root.querySelector<HTMLButtonElement>(".set-close")!.onclick = () => void this.toggle();
    this.root.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => {
      b.onclick = async () => {
        await navigator.clipboard?.writeText(b.dataset.copy!).catch(() => {});
        b.textContent = "Copied";
      };
    });
    this.root.querySelectorAll<HTMLFormElement>("form[data-add]").forEach((f) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const name = new FormData(f).get("name")?.toString().trim() ?? "";
        if (!name) return;
        try {
          if (f.dataset.add === "user") {
            const role = new FormData(f).get("admin") ? "admin" : "member";
            const r = await api<{ user: OfficeUser; token: string }>("POST", "/api/users", { name, role });
            this.secret = { kind: "user", name: r.user.name, value: r.token };
          } else {
            const r = await api<{ display: DisplayLink; code: string }>("POST", "/api/displays", { name });
            this.secret = { kind: "display", name: r.display.name, value: r.code };
          }
        } catch (err) {
          this.error = String(err instanceof Error ? err.message : err);
        }
        await this.reload();
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-role]").forEach((b) => {
      b.onclick = async () => {
        await api("PATCH", `/api/users/${b.dataset.role}`, { role: b.dataset.to }).catch((err) => {
          this.error = String(err instanceof Error ? err.message : err);
        });
        await this.reload();
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-new-user],[data-new-display]").forEach((b) => {
      b.onclick = async () => {
        const isUser = !!b.dataset.newUser;
        const what = isUser
          ? `Give ${b.dataset.name} a new token? Their current token stops working right away.`
          : `Make a new code for "${b.dataset.name}"? The old code stops working (a screen that's already logged in stays logged in).`;
        if (!confirm(what)) return;
        try {
          if (isUser) {
            const r = await api<{ token: string }>("POST", `/api/users/${b.dataset.newUser}/token`);
            this.secret = { kind: "user", name: b.dataset.name!, value: r.token };
          } else {
            const r = await api<{ code: string }>("POST", `/api/displays/${b.dataset.newDisplay}/code`);
            this.secret = { kind: "display", name: b.dataset.name!, value: r.code };
          }
        } catch (err) {
          this.error = String(err instanceof Error ? err.message : err);
        }
        await this.reload();
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-reset-pw]").forEach((b) => {
      b.onclick = async () => {
        if (!confirm(`Clear ${b.dataset.name}'s password? They log in with their token until they set a new one.`)) return;
        try {
          await api("DELETE", `/api/users/${b.dataset.resetPw}/password`);
        } catch (err) {
          alert(String(err instanceof Error ? err.message : err));
        }
        await this.reload();
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-del-user],[data-del-display]").forEach((b) => {
      b.onclick = async () => {
        const isUser = !!b.dataset.delUser;
        const what = isUser ? `Remove ${b.dataset.name}? Their token stops working right away.` : `Remove the screen "${b.dataset.name}"? It is logged out.`;
        if (!confirm(what)) return;
        await api("DELETE", isUser ? `/api/users/${b.dataset.delUser}` : `/api/displays/${b.dataset.delDisplay}`).catch((err) => {
          this.error = String(err instanceof Error ? err.message : err);
        });
        this.secret = undefined;
        await this.reload();
      };
    });
  }
}

/** "You": your name and role, your own password, a new token for yourself, and log out. */
export class MePanel {
  private token: string | undefined;
  /** What happened to the last password change: a note to show, good or bad. */
  private passwordNote: { ok: boolean; text: string } | undefined;

  constructor(private root: HTMLElement) {}

  async toggle(me: Me | undefined, role: string): Promise<void> {
    if (this.root.classList.toggle("open")) this.render(me, role);
    else {
      this.token = undefined;
      this.passwordNote = undefined;
    }
  }

  private render(me: Me | undefined, role: string): void {
    const origin = location.origin;
    this.root.innerHTML = `
      <div class="set-head"><b>${me ? esc(me.name) : "Admin token"}</b><button class="set-close" title="Close">×</button></div>
      <p class="muted">${role === "admin" ? "Admin — you can manage people, screens and settings." : "Member — you can watch the office and manage your own token."}
      ${me ? "Your agents are highlighted in the office." : "You're logged in with the setup key. Add yourself in 👥 People as an admin, then log in with your own name and token."}</p>
      ${
        this.token
          ? `<div class="secret"><b>Your new token</b> — shown only now. Your old one has stopped working.
             <code>${esc(this.token)}</code><button data-copy="${esc(this.token)}">Copy</button>
             <p class="muted">Put it in the Claude plugin (/config → pixel-office, server ${esc(origin)}) and use it next time you log in.</p></div>`
          : ""
      }
      ${
        me
          ? `<form class="me-password">
               <b>${me.hasPassword ? "Change your password" : "Set a password"}</b>
               <p class="muted">${
                 me.hasPassword
                   ? "You log in with your name and this password. Your token still works too (it's what the Claude plugin uses)."
                   : "Pick your own password to log in with, instead of pasting your token. The plugin keeps using the token."
               }</p>
               ${me.hasPassword ? `<input name="current" type="password" autocomplete="current-password" placeholder="Current password" required />` : ""}
               <input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="New password (at least 8 characters)" required />
               <input name="repeat" type="password" autocomplete="new-password" minlength="8" placeholder="New password again" required />
               ${this.passwordNote ? `<p class="${this.passwordNote.ok ? "ok" : "error"}">${esc(this.passwordNote.text)}</p>` : ""}
               <button type="submit">${me.hasPassword ? "Change password" : "Set password"}</button>
             </form>`
          : ""
      }
      <div class="set-actions">
        ${me ? `<button class="me-new">Get a new token</button>` : "<span></span>"}
        <form method="post" action="/logout"><button type="submit">Log out</button></form>
      </div>`;
    this.root.querySelector<HTMLButtonElement>(".set-close")!.onclick = () => void this.toggle(me, role);
    this.root.querySelector<HTMLButtonElement>("[data-copy]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      await navigator.clipboard?.writeText(b.dataset.copy!).catch(() => {});
      b.textContent = "Copied";
    });
    this.root.querySelector<HTMLFormElement>(".me-password")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!me) return;
      const f = new FormData(e.currentTarget as HTMLFormElement);
      const password = String(f.get("password") ?? "");
      if (password !== String(f.get("repeat") ?? "")) {
        this.passwordNote = { ok: false, text: "The two new passwords aren't the same." };
        return this.render(me, role);
      }
      const res = await fetch("/api/me/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-po-csrf": "1", "content-type": "application/json" },
        body: JSON.stringify({ password, ...(me.hasPassword ? { current: String(f.get("current") ?? "") } : {}) }),
      }).catch(() => undefined);
      if (res?.ok) {
        this.passwordNote = { ok: true, text: me.hasPassword ? "Password changed." : "Password set. Use it next time you log in." };
        me.hasPassword = true;
      } else {
        const why = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : undefined;
        this.passwordNote = { ok: false, text: why ? why[0]!.toUpperCase() + why.slice(1) : "That didn't work. Try again." };
      }
      this.render(me, role);
    });
    this.root.querySelector<HTMLButtonElement>(".me-new")?.addEventListener("click", async () => {
      if (!confirm("Get a new token? Your current one stops working right away — in the Claude plugin too.")) return;
      try {
        this.token = (await api<{ token: string }>("POST", "/api/me/token")).token;
      } catch (err) {
        alert(String(err instanceof Error ? err.message : err));
      }
      this.render(me, role);
    });
  }
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "x-po-csrf": "1", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 409) throw new Error("That name is already taken.");
  if (!res.ok) throw new Error(`${method} ${url} failed (${res.status})`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
