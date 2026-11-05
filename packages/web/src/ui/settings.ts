import { DEFAULT_SETTINGS, type OfficeSettings, type TopRoom } from "@pixel-office/protocol";
import type { OfficeStore } from "../net.js";

const ROOM_NAMES: Record<TopRoom, string> = {
  library: "Library",
  server: "Server room",
  lab: "Test lab",
  git: "Git room",
  mail: "Mailroom",
};

const MIN_LABELS: [keyof OfficeSettings["minRooms"], string][] = [
  ["library", "Library"],
  ["server", "Server room"],
  ["lab", "Test lab"],
  ["git", "Git room"],
  ["mail", "Mailroom"],
  ["lounge", "Lounge"],
  ["reception", "Reception"],
  ["globe", "Globe desks"],
  ["filing", "Filing cabinets"],
];

/**
 * Office settings: the layout editor for a generated office. Room order along
 * the top, each room's minimum size, teams per row, rugs and plants. Saved on
 * the server, so every browser sees the same office.
 */
export class SettingsPanel {
  private draft: OfficeSettings = structuredClone(DEFAULT_SETTINGS);

  constructor(
    private root: HTMLElement,
    private store: OfficeStore,
  ) {
    store.onSettings((s) => {
      if (!this.isOpen) this.draft = structuredClone(s);
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  toggle(): void {
    if (this.isOpen) return this.close();
    this.draft = structuredClone(this.store.settings);
    this.root.classList.add("open");
    this.render();
  }

  close(): void {
    this.root.classList.remove("open");
  }

  private render(): void {
    const d = this.draft;
    const order = d.roomOrder
      .map(
        (r, i) => `
        <li>
          <span>${ROOM_NAMES[r]}</span>
          <button data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move left">◀</button>
          <button data-move="${i}" data-dir="1" ${i === d.roomOrder.length - 1 ? "disabled" : ""} title="Move right">▶</button>
        </li>`,
      )
      .join("");
    const mins = MIN_LABELS.map(
      ([k, label]) => `
        <label class="set-num">${label}
          <input type="number" min="1" max="30" data-min="${k}" value="${d.minRooms[k]}" />
        </label>`,
    ).join("");
    this.root.innerHTML = `
      <div class="set-head"><b>Office layout</b><button class="set-close" title="Close">×</button></div>
      <p class="muted">The office is generated to fit who's online. These are its ground rules; they're shared by everyone who opens this office.</p>
      <section><span class="section-title">Rooms along the top, left to right</span><ol class="set-order">${order}</ol></section>
      <section><span class="section-title">Smallest size (agents each room fits)</span><div class="set-grid">${mins}</div></section>
      <section><span class="section-title">Team areas</span>
        <label class="set-num">Side by side
          <select data-teams>${[1, 2, 3, 4].map((n) => `<option ${n === d.teamsPerRow ? "selected" : ""}>${n}</option>`).join("")}</select>
        </label>
        <label class="set-check"><input type="checkbox" data-rugs ${d.rugs ? "checked" : ""}/> Coloured rugs</label>
        <label class="set-check"><input type="checkbox" data-plants ${d.plants ? "checked" : ""}/> Plants</label>
      </section>
      <div class="set-actions">
        <button class="set-reset">Defaults</button>
        <span class="set-status muted"></span>
        <button class="set-save">Save</button>
      </div>
    `;
    this.root.querySelector<HTMLButtonElement>(".set-close")!.onclick = () => this.close();
    this.root.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.move);
        const j = i + Number(b.dataset.dir);
        const o = [...d.roomOrder];
        [o[i], o[j]] = [o[j]!, o[i]!];
        d.roomOrder = o;
        this.render();
      };
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-min]").forEach((inp) => {
      inp.onchange = () => {
        const k = inp.dataset.min as keyof OfficeSettings["minRooms"];
        d.minRooms[k] = Math.min(30, Math.max(1, Math.round(Number(inp.value)) || 1));
      };
    });
    this.root.querySelector<HTMLSelectElement>("[data-teams]")!.onchange = (e) => {
      d.teamsPerRow = Number((e.target as HTMLSelectElement).value);
    };
    this.root.querySelector<HTMLInputElement>("[data-rugs]")!.onchange = (e) => {
      d.rugs = (e.target as HTMLInputElement).checked;
    };
    this.root.querySelector<HTMLInputElement>("[data-plants]")!.onchange = (e) => {
      d.plants = (e.target as HTMLInputElement).checked;
    };
    this.root.querySelector<HTMLButtonElement>(".set-reset")!.onclick = () => {
      this.draft = structuredClone(DEFAULT_SETTINGS);
      this.render();
    };
    const status = this.root.querySelector<HTMLElement>(".set-status")!;
    this.root.querySelector<HTMLButtonElement>(".set-save")!.onclick = async () => {
      status.textContent = "saving…";
      try {
        await this.store.saveSettings(this.draft);
        status.textContent = "saved";
        setTimeout(() => this.close(), 400);
      } catch (err) {
        status.textContent = String(err instanceof Error ? err.message : err);
      }
    };
  }
}
