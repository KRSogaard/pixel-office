import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type OfficeSettings } from "@pixel-office/protocol";
import { z } from "zod";

const size = z.number().int().min(1).max(30);
const TOP_ROOMS = ["web", "server", "cafe", "lab", "git", "mail"] as const;

export const settingsSchema = z.object({
  roomOrder: z
    .array(z.enum(TOP_ROOMS))
    .length(TOP_ROOMS.length)
    .refine((order) => new Set(order).size === TOP_ROOMS.length, "roomOrder must list each room once"),
  minRooms: z.object({
    web: size,
    server: size,
    lab: size,
    git: size,
    mail: size,
    lounge: size,
    reception: size,
    filing: size,
  }),
  teamsPerRow: z.number().int().min(1).max(4),
  rugs: z.boolean(),
  plants: z.boolean(),
}) satisfies z.ZodType<OfficeSettings>;

export type SettingsListener = (s: OfficeSettings) => void;

/** Shared office settings, saved as DATA_DIR/settings.json. */
export class SettingsStore {
  private current: OfficeSettings;
  private readonly listeners = new Set<SettingsListener>();
  private readonly file: string | undefined;

  constructor(dataDir?: string) {
    this.file = dataDir ? join(dataDir, "settings.json") : undefined;
    this.current = this.load();
  }

  get(): OfficeSettings {
    return this.current;
  }

  /** Validates, saves and notifies. Throws a ZodError on bad input. */
  set(input: unknown): OfficeSettings {
    const next = settingsSchema.parse(input);
    this.current = next;
    if (this.file) {
      mkdirSync(join(this.file, ".."), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2));
      renameSync(tmp, this.file);
    }
    for (const l of this.listeners) l(next);
    return next;
  }

  subscribe(l: SettingsListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private load(): OfficeSettings {
    if (!this.file || !existsSync(this.file)) return DEFAULT_SETTINGS;
    try {
      // Merge over defaults so settings files from older versions keep working.
      const raw = migrate(JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>) as Partial<OfficeSettings>;
      return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...raw, minRooms: { ...DEFAULT_SETTINGS.minRooms, ...raw.minRooms } });
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
}

/**
 * Carry old settings files over: the meeting room became the test lab, the
 * git room was added (placed just before the mailroom, or at the end), the
 * café (placed just before the test lab, or at the end), and the library became
 * the internet room (its size: the old web desks' or library's, whichever was bigger).
 */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  if (Array.isArray(out.roomOrder)) {
    const order = out.roomOrder.map((r) => (r === "meeting" ? "lab" : r === "library" ? "web" : r));
    if (!order.includes("git")) {
      const mail = order.indexOf("mail");
      order.splice(mail >= 0 ? mail : order.length, 0, "git");
    }
    if (!order.includes("cafe")) {
      const lab = order.indexOf("lab");
      order.splice(lab >= 0 ? lab : order.length, 0, "cafe");
    }
    out.roomOrder = order;
  }
  if (out.minRooms && typeof out.minRooms === "object") {
    const { meeting: _meeting, library, globe, ...rest } = out.minRooms as Record<string, unknown>;
    if (rest.web === undefined && (typeof library === "number" || typeof globe === "number")) {
      rest.web = Math.max(typeof library === "number" ? library : 0, typeof globe === "number" ? globe : 0);
    }
    out.minRooms = rest;
  }
  return out;
}
