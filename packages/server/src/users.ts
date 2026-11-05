import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DisplayLink, OfficeUser } from "@pixel-office/protocol";

/**
 * People and screens, saved as DATA_DIR/users.json.
 *
 *  - A person has their own ingest token; events sent with it are labelled
 *    with their name.
 *  - A display link is a read-only key for a screen (a TV in the office):
 *    opening /tv?key=… once logs that browser in as a viewer.
 *
 * Only SHA-256 hashes of tokens and keys are stored; the plaintext is returned
 * once, when it's created. The file is re-read when it changes on disk, so
 * `pixel-office user add` works while the server is running.
 */

interface StoredUser {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt?: number;
}

interface StoredDisplay {
  id: string;
  name: string;
  keyHash: string;
  createdAt: number;
}

interface StoredFile {
  users: StoredUser[];
  displays: StoredDisplay[];
}

export class UserError extends Error {
  constructor(
    readonly code: "invalid" | "duplicate",
    message: string,
  ) {
    super(message);
  }
}

const USER_PREFIX = "po_u_";
const DISPLAY_PREFIX = "po_d_";
/** lastSeenAt is saved at most this often. */
const TOUCH_SAVE_MS = 60_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newSecret(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

/** Letters for TV codes: no i, l or o, so a code is easy to read off a screen and type. */
const CODE_LETTERS = "abcdefghjkmnpqrstuvwxyz";

/** A TV code: six letters written "abc-def" (23^6 ≈ 148 million codes). */
export function newTvCode(): string {
  let s = "";
  while (s.length < 6) {
    const b = randomBytes(1)[0]!;
    // Skip the top of the byte range so every letter is equally likely.
    if (b < 256 - (256 % CODE_LETTERS.length)) s += CODE_LETTERS[b % CODE_LETTERS.length];
  }
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/** "ABC DEF", "abcdef", " abc-def " → "abc-def"; anything else → undefined. */
export function normalizeTvCode(input: string): string | undefined {
  const letters = input.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length !== 6 || [...letters].some((c) => !CODE_LETTERS.includes(c))) return undefined;
  return `${letters.slice(0, 3)}-${letters.slice(3)}`;
}

function cleanName(name: unknown): string {
  if (typeof name !== "string") throw new UserError("invalid", "name must be a string");
  const n = name.trim();
  if (n.length < 1 || n.length > 40) throw new UserError("invalid", "name must be 1–40 characters");
  return n;
}

/** Constant-time comparison of two hex digests of equal length. */
function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export class UsersStore {
  private data: StoredFile = { users: [], displays: [] };
  private readonly file: string | undefined;
  private mtime = 0;
  private dirty = false;
  private lastSave = 0;

  constructor(dataDir?: string) {
    this.file = dataDir ? join(dataDir, "users.json") : undefined;
    this.load();
  }

  // --- people ---------------------------------------------------------------

  listUsers(): OfficeUser[] {
    this.refresh();
    return this.data.users.map(publicUser);
  }

  addUser(name: unknown, now = Date.now()): { user: OfficeUser; token: string } {
    this.refresh();
    const n = cleanName(name);
    if (this.data.users.some((u) => u.name.toLowerCase() === n.toLowerCase())) {
      throw new UserError("duplicate", `someone called "${n}" already exists`);
    }
    const token = newSecret(USER_PREFIX);
    const stored: StoredUser = { id: randomUUID(), name: n, tokenHash: hashToken(token), createdAt: now };
    this.data.users.push(stored);
    this.save();
    return { user: publicUser(stored), token };
  }

  removeUser(id: string): boolean {
    this.refresh();
    const before = this.data.users.length;
    this.data.users = this.data.users.filter((u) => u.id !== id);
    if (this.data.users.length === before) return false;
    this.save();
    return true;
  }

  removeUserByName(name: string): boolean {
    const u = this.findByName(this.data.users, name);
    return u ? this.removeUser(u.id) : false;
  }

  /** The person a presented ingest token belongs to, if any. */
  findUserByToken(token: string): OfficeUser | undefined {
    if (!token.startsWith(USER_PREFIX)) return undefined;
    this.refresh();
    const h = hashToken(token);
    let found: StoredUser | undefined;
    // Compare against every stored hash so timing doesn't reveal which one matched.
    for (const u of this.data.users) if (sameHash(h, u.tokenHash)) found = u;
    return found && publicUser(found);
  }

  /** Remember when someone's agents were last seen. Saved at most once a minute. */
  touch(id: string, now = Date.now()): void {
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return;
    u.lastSeenAt = now;
    this.dirty = true;
    if (now - this.lastSave >= TOUCH_SAVE_MS) this.save(now);
  }

  // --- display links --------------------------------------------------------

  listDisplays(): DisplayLink[] {
    this.refresh();
    return this.data.displays.map(publicDisplay);
  }

  /** Give someone a new token; the old one stops working at once. */
  regenerateUserToken(id: string): string | undefined {
    this.refresh();
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return undefined;
    const token = newSecret(USER_PREFIX);
    u.tokenHash = hashToken(token);
    this.save();
    return token;
  }

  findUserIdByName(name: string): string | undefined {
    return this.findByName(this.data.users, name)?.id;
  }

  addDisplay(name: unknown, now = Date.now()): { display: DisplayLink; key: string } {
    this.refresh();
    const n = cleanName(name);
    let key = newTvCode();
    while (this.findDisplayByKey(key)) key = newTvCode();
    const stored: StoredDisplay = { id: randomUUID(), name: n, keyHash: hashToken(key), createdAt: now };
    this.data.displays.push(stored);
    this.save();
    return { display: publicDisplay(stored), key };
  }

  /** A new TV code for a screen. Screens already logged in stay logged in. */
  regenerateDisplayCode(id: string): string | undefined {
    this.refresh();
    const d = this.data.displays.find((x) => x.id === id);
    if (!d) return undefined;
    let code = newTvCode();
    while (this.findDisplayByKey(code)) code = newTvCode();
    d.keyHash = hashToken(code);
    this.save();
    return code;
  }

  removeDisplay(id: string): boolean {
    this.refresh();
    const before = this.data.displays.length;
    this.data.displays = this.data.displays.filter((d) => d.id !== id);
    if (this.data.displays.length === before) return false;
    this.save();
    return true;
  }

  removeDisplayByName(name: string): boolean {
    const d = this.findByName(this.data.displays, name);
    return d ? this.removeDisplay(d.id) : false;
  }

  /** A TV code (any spacing/case) — or a long key from before TV codes existed. */
  findDisplayByKey(key: string): DisplayLink | undefined {
    const code = key.startsWith(DISPLAY_PREFIX) ? key : normalizeTvCode(key);
    if (!code) return undefined;
    this.refresh();
    const h = hashToken(code);
    let found: StoredDisplay | undefined;
    for (const d of this.data.displays) if (sameHash(h, d.keyHash)) found = d;
    return found && publicDisplay(found);
  }

  /** Is this display link still valid? (Revoking one ends its viewer sessions.) */
  hasDisplay(id: string): boolean {
    this.refresh();
    return this.data.displays.some((d) => d.id === id);
  }

  /** Write pending lastSeenAt updates (on shutdown). */
  flush(): void {
    if (this.dirty) this.save();
  }

  // --- persistence ----------------------------------------------------------

  private findByName<T extends { name: string }>(list: T[], name: string): T | undefined {
    this.refresh();
    const n = name.trim().toLowerCase();
    return list.find((x) => x.name.toLowerCase() === n);
  }

  /** Pick up changes another process (the CLI) made to users.json. */
  private refresh(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const m = statSync(this.file).mtimeMs;
      if (m !== this.mtime) this.load();
    } catch {
      // keep what we have
    }
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoredFile>;
      // Keep in-memory lastSeenAt values that haven't been saved yet.
      const seen = new Map(this.data.users.map((u) => [u.id, u.lastSeenAt]));
      this.data = {
        users: Array.isArray(raw.users) ? raw.users : [],
        displays: Array.isArray(raw.displays) ? raw.displays : [],
      };
      for (const u of this.data.users) {
        const s = seen.get(u.id);
        if (s && (!u.lastSeenAt || s > u.lastSeenAt)) u.lastSeenAt = s;
      }
      this.mtime = statSync(this.file).mtimeMs;
    } catch {
      // Corrupt file: start empty rather than crash; it is rewritten on the next change.
    }
  }

  private save(now = Date.now()): void {
    this.dirty = false;
    this.lastSave = now;
    if (!this.file) return;
    mkdirSync(join(this.file, ".."), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.mtime = statSync(this.file).mtimeMs;
  }
}

function publicUser(u: StoredUser): OfficeUser {
  return { id: u.id, name: u.name, createdAt: u.createdAt, ...(u.lastSeenAt ? { lastSeenAt: u.lastSeenAt } : {}) };
}

function publicDisplay(d: StoredDisplay): DisplayLink {
  return { id: d.id, name: d.name, createdAt: d.createdAt };
}
