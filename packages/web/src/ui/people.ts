import type { DisplayLink, OfficeUser } from "@pixel-office/protocol";

/**
 * People and TV links (admins only).
 *
 * People: everyone who sends agents to this office gets their own ingest token,
 * so their agents are labelled with their name. A token is shown once, when the
 * person is added; removing the person revokes it.
 *
 * TV links: a secret URL for a screen in the office. Opened once, that browser
 * stays logged in as a viewer (it can watch, not change anything). Removing the
 * link logs the screen out.
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
          <p class="muted">${esc(this.secret.name)} sets it up in Claude Code:</p>
          <pre>/plugin marketplace add KRSogaard/pixel-office
/plugin install pixel-office@pixel-office
Server URL: ${esc(origin)}
Ingest token: (the token above)</pre>
          <p class="muted">OpenCode: set PIXEL_OFFICE_URL=${esc(origin)} and PIXEL_OFFICE_TOKEN to the token.</p>
        </div>`
        : `
        <div class="secret">
          <b>TV link for ${esc(this.secret.name)}</b> — open it once on the screen:
          <code>${esc(origin + this.secret.value)}</code>
          <button data-copy="${esc(origin + this.secret.value)}">Copy</button>
          <p class="muted">That browser stays logged in for a year as a viewer. Remove the link to log it out.</p>
        </div>`
      : "";
    const when = (t?: number) => (t ? new Date(t).toLocaleString() : "never");
    this.root.innerHTML = `
      <div class="set-head"><b>People &amp; TV links</b><button class="set-close" title="Close">×</button></div>
      ${this.error ? `<p class="err">${esc(this.error)}</p>` : ""}
      ${secret}
      <section><span class="section-title">People</span>
        <p class="muted">Everyone gets their own token, so their agents carry their name.</p>
        <table class="people">
          ${this.users.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td class="muted">last seen ${when(u.lastSeenAt)}</td><td><button data-del-user="${esc(u.id)}" data-name="${esc(u.name)}">Remove</button></td></tr>`).join("") || `<tr><td class="muted">Nobody yet.</td></tr>`}
        </table>
        <form class="add" data-add="user"><input name="name" maxlength="40" placeholder="Name, e.g. Morten" required /><button>Add person</button></form>
      </section>
      <section><span class="section-title">TV links</span>
        <p class="muted">A read-only link for a screen in the office.</p>
        <table class="people">
          ${this.displays.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td class="muted">created ${when(d.createdAt)}</td><td><button data-del-display="${esc(d.id)}" data-name="${esc(d.name)}">Remove</button></td></tr>`).join("") || `<tr><td class="muted">No TV links yet.</td></tr>`}
        </table>
        <form class="add" data-add="display"><input name="name" maxlength="40" placeholder="Screen, e.g. Kitchen TV" required /><button>Create TV link</button></form>
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
            const r = await api<{ user: OfficeUser; token: string }>("POST", "/api/users", { name });
            this.secret = { kind: "user", name: r.user.name, value: r.token };
          } else {
            const r = await api<{ display: DisplayLink; url: string }>("POST", "/api/displays", { name });
            this.secret = { kind: "display", name: r.display.name, value: r.url };
          }
        } catch (err) {
          this.error = String(err instanceof Error ? err.message : err);
        }
        await this.reload();
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-del-user],[data-del-display]").forEach((b) => {
      b.onclick = async () => {
        const isUser = !!b.dataset.delUser;
        const what = isUser ? `Remove ${b.dataset.name}? Their token stops working right away.` : `Remove the TV link "${b.dataset.name}"? That screen is logged out.`;
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
