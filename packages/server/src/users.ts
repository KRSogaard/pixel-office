import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DisplayLink, OfficeUser, TokenInfo } from "@pixel-office/protocol";
import { hashPassword, verifyPassword } from "./secrets.js";

/**
 * People and screens, saved as DATA_DIR/users.json.
 *
 *  - A person has one or more ingest tokens of their own (one per computer,
 *    say); events sent with any of them are labelled with their name. They log
 *    in with their name and any of their tokens, or with a password they chose
 *    themselves (the tokens stay the plugins' keys).
 *  - A display link is a read-only key for a screen (a TV in the office):
 *    opening /tv?key=… once logs that browser in as a viewer.
 *
 * Only SHA-256 hashes of tokens and keys are stored; the plaintext is returned
 * once, when it's created. The file is re-read when it changes on disk, so
 * `pixel-office user add` works while the server is running.
 */

export type PersonRole = "admin" | "member";

interface StoredToken {
  id: string;
  name: string;
  hash: string;
  /** The token's last 4 characters. */
  hint?: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface StoredUser {
  id: string;
  name: string;
  /** Missing in users.json from older versions → "member". */
  role?: PersonRole;
  tokens: StoredToken[];
  /** users.json from before people could have several tokens: their one token. Moved into `tokens` on load. */
  tokenHash?: string;
  /** Their own password for logging in (scrypt), if they've set one. */
  passwordHash?: string;
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
/** Tokens one person can have (one per computer is plenty). */
const MAX_TOKENS = 20;
const DISPLAY_PREFIX = "po_d_";
/** lastSeenAt / lastUsedAt are saved at most this often. */
const TOUCH_SAVE_MS = 60_000;

/** A new token for a person: the plaintext (shown once) and what's stored. */
function newUserToken(name: string, now: number): { token: string; stored: StoredToken } {
  const token = newSecret(USER_PREFIX);
  return { token, stored: { id: randomUUID(), name, hash: hashToken(token), hint: token.slice(-4), createdAt: now } };
}

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

function cleanRole(role: unknown): PersonRole {
  if (role === undefined || role === null || role === "") return "member";
  if (role === "admin" || role === "member") return role;
  throw new UserError("invalid", 'role must be "admin" or "member"');
}

/** A password someone picked: 8–200 characters. */
export const PASSWORD_MIN = 8;
function cleanPassword(password: unknown): string {
  if (typeof password !== "string") throw new UserError("invalid", "password must be a string");
  if (password.length < PASSWORD_MIN) throw new UserError("invalid", `password must be at least ${PASSWORD_MIN} characters`);
  if (password.length > 200) throw new UserError("invalid", "password must be at most 200 characters");
  return password;
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

  addUser(name: unknown, role: unknown = "member", now = Date.now()): { user: OfficeUser; token: string } {
    this.refresh();
    const n = cleanName(name);
    const r = cleanRole(role);
    if (this.data.users.some((u) => u.name.toLowerCase() === n.toLowerCase())) {
      throw new UserError("duplicate", `someone called "${n}" already exists`);
    }
    const { token, stored: first } = newUserToken("First token", now);
    const stored: StoredUser = { id: randomUUID(), name: n, role: r, tokens: [first], createdAt: now };
    this.data.users.push(stored);
    this.save();
    return { user: publicUser(stored), token };
  }

  /** Make someone an admin or a member. Returns the updated person, or undefined if unknown. */
  setRole(id: string, role: unknown): OfficeUser | undefined {
    this.refresh();
    const r = cleanRole(role);
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return undefined;
    u.role = r;
    this.save();
    return publicUser(u);
  }

  /** Is any person an admin? (While nobody is, the old shared password still logs in.) */
  hasAdmins(): boolean {
    this.refresh();
    return this.data.users.some((u) => u.role === "admin");
  }

  /** A person by id, with their current role. */
  getUser(id: string): OfficeUser | undefined {
    this.refresh();
    const u = this.data.users.find((x) => x.id === id);
    return u && publicUser(u);
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

  /** The person a presented ingest token belongs to, if any, and which of their tokens it is. */
  findUserByToken(token: string): (OfficeUser & { tokenId: string }) | undefined {
    if (!token.startsWith(USER_PREFIX)) return undefined;
    this.refresh();
    const h = hashToken(token);
    let found: { user: StoredUser; token: StoredToken } | undefined;
    // Compare against every stored hash so timing doesn't reveal which one matched.
    for (const u of this.data.users) for (const t of u.tokens) if (sameHash(h, t.hash)) found = { user: u, token: t };
    return found && { ...publicUser(found.user), tokenId: found.token.id };
  }

  // --- a person's own tokens ------------------------------------------------

  /** Someone's tokens, oldest first. Undefined if there's no such person. */
  listTokens(userId: string): TokenInfo[] | undefined {
    this.refresh();
    return this.data.users.find((x) => x.id === userId)?.tokens.map(publicToken);
  }

  /** A new token for someone, next to the ones they have. The plaintext is returned only now. */
  addToken(userId: string, name: unknown, now = Date.now()): { info: TokenInfo; token: string } | undefined {
    this.refresh();
    const n = typeof name === "string" && name.trim() === "" ? "Token" : cleanName(name);
    const u = this.data.users.find((x) => x.id === userId);
    if (!u) return undefined;
    if (u.tokens.length >= MAX_TOKENS) throw new UserError("invalid", `you can have at most ${MAX_TOKENS} tokens; delete one first`);
    const { token, stored } = newUserToken(n, now);
    u.tokens.push(stored);
    this.save();
    return { info: publicToken(stored), token };
  }

  /**
   * Delete one of someone's tokens; it stops working at once. Their last token can only
   * go if they have a password, or they could never log in again. False if not found.
   */
  removeToken(userId: string, tokenId: string): boolean {
    this.refresh();
    const u = this.data.users.find((x) => x.id === userId);
    if (!u?.tokens.some((t) => t.id === tokenId)) return false;
    if (u.tokens.length === 1 && !u.passwordHash) {
      throw new UserError("invalid", "this is your only way to log in: set a password or add another token first");
    }
    u.tokens = u.tokens.filter((t) => t.id !== tokenId);
    this.save();
    return true;
  }

  /** The person with this name, if they've set a password and it's this one. */
  findUserByPassword(name: string, password: string): OfficeUser | undefined {
    this.refresh();
    const u = this.findByName(this.data.users, name);
    // A miss still costs one scrypt, so timing doesn't tell who has a password.
    const ok = verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
    return u?.passwordHash && ok ? publicUser(u) : undefined;
  }

  /** Is `password` this person's current password? */
  checkPassword(id: string, password: string): boolean {
    this.refresh();
    const u = this.data.users.find((x) => x.id === id);
    return !!u?.passwordHash && verifyPassword(password, u.passwordHash);
  }

  /** Set (or change) someone's password. Their token keeps working. */
  setPassword(id: string, password: unknown): OfficeUser | undefined {
    this.refresh();
    const p = cleanPassword(password);
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return undefined;
    u.passwordHash = hashPassword(p);
    this.save();
    return publicUser(u);
  }

  /** Forget someone's password (they log in with their token again, and can set a new one). */
  clearPassword(id: string): OfficeUser | undefined {
    this.refresh();
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return undefined;
    delete u.passwordHash;
    this.save();
    return publicUser(u);
  }

  /**
   * Remember when someone's agents were last seen (and, given a token, when that token
   * was last used). Saved at most once a minute.
   */
  touch(id: string, now = Date.now(), tokenId?: string): void {
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return;
    u.lastSeenAt = now;
    const t = tokenId ? u.tokens.find((x) => x.id === tokenId) : undefined;
    if (t) t.lastUsedAt = now;
    this.dirty = true;
    if (now - this.lastSave >= TOUCH_SAVE_MS) this.save(now);
  }

  // --- display links --------------------------------------------------------

  listDisplays(): DisplayLink[] {
    this.refresh();
    return this.data.displays.map(publicDisplay);
  }

  /**
   * For a lost or leaked token (an admin, or `user token` on the server): every token the
   * person has stops working at once, and they get one new one.
   */
  regenerateUserToken(id: string, now = Date.now()): string | undefined {
    this.refresh();
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return undefined;
    const { token, stored } = newUserToken("New token", now);
    u.tokens = [stored];
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
      // Keep in-memory lastSeenAt / lastUsedAt values that haven't been saved yet.
      const seen = new Map(this.data.users.map((u) => [u.id, u.lastSeenAt]));
      const used = new Map(this.data.users.flatMap((u) => u.tokens.map((t) => [t.id, t.lastUsedAt] as const)));
      this.data = {
        users: Array.isArray(raw.users) ? raw.users.map(withTokenList) : [],
        displays: Array.isArray(raw.displays) ? raw.displays : [],
      };
      for (const u of this.data.users) {
        const s = seen.get(u.id);
        if (s && (!u.lastSeenAt || s > u.lastSeenAt)) u.lastSeenAt = s;
        for (const t of u.tokens) {
          const l = used.get(t.id);
          if (l && (!t.lastUsedAt || l > t.lastUsedAt)) t.lastUsedAt = l;
        }
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
  return {
    id: u.id,
    name: u.name,
    role: u.role ?? "member",
    createdAt: u.createdAt,
    ...(u.lastSeenAt ? { lastSeenAt: u.lastSeenAt } : {}),
    ...(u.passwordHash ? { hasPassword: true } : {}),
  };
}

function publicToken(t: StoredToken): TokenInfo {
  return {
    id: t.id,
    name: t.name,
    ...(t.hint ? { hint: t.hint } : {}),
    createdAt: t.createdAt,
    ...(t.lastUsedAt ? { lastUsedAt: t.lastUsedAt } : {}),
  };
}

/**
 * A person as read from users.json. Files from before several tokens hold one `tokenHash`:
 * it becomes their first token, with an id made from the hash so it's the same every load
 * (another process may re-read the file before this one saves it).
 */
function withTokenList(u: StoredUser): StoredUser {
  if (Array.isArray(u.tokens)) return u;
  const { tokenHash, ...rest } = u;
  const tokens: StoredToken[] = tokenHash
    ? [{ id: `t-${tokenHash.slice(0, 16)}`, name: "First token", hash: tokenHash, createdAt: u.createdAt, ...(u.lastSeenAt ? { lastUsedAt: u.lastSeenAt } : {}) }]
    : [];
  return { ...rest, tokens };
}

/** Checked against when a name has no password, so a miss takes as long as a hit. */
const DUMMY_HASH = hashPassword("pixel-office-no-password");

function publicDisplay(d: StoredDisplay): DisplayLink {
  return { id: d.id, name: d.name, createdAt: d.createdAt };
}
