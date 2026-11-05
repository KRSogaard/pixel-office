import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "@pixel-office/protocol";

interface StoredSecrets {
  sessionSecret: string;
  ingestToken: string;
  /** `scrypt$<salt hex>$<hash hex>`. Only on installs from before name + token login. */
  passwordHash?: string;
  /** SHA-256 hex of the admin token (the token itself is never stored). */
  adminTokenHash: string;
}

export interface Secrets {
  sessionSecret: string;
  ingestToken: string;
  /**
   * The old shared password, if one was ever set (env PIXEL_OFFICE_PASSWORD or an
   * older install). It only logs in while no person has the admin role.
   */
  passwordHash?: string;
  /** SHA-256 hex of the admin token. Optional so older callers/tests keep working. */
  adminTokenHash?: string;
}

export interface SecretsResult {
  secrets: Secrets;
  /** Values generated on this run that the operator has never seen. Print once. */
  generated: { password?: string; ingestToken?: string; adminToken?: string };
}

const ADMIN_PREFIX = "po_a_";

export function newAdminToken(): string {
  return ADMIN_PREFIX + randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Does `presented` match the stored admin token hash? Constant time. */
export function isAdminToken(secrets: Secrets, presented: string | undefined): boolean {
  if (!presented || !secrets.adminTokenHash) return false;
  const a = Buffer.from(sha256(presented), "hex");
  const b = Buffer.from(secrets.adminTokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Replace the admin token: stores the new hash in DATA_DIR/secrets.json and
 * returns the plaintext (show it once). The old token stops working at once
 * for a running server only after it restarts — it caches secrets at start.
 */
export function rotateAdminToken(dataDir: string): string {
  const file = join(dataDir, "secrets.json");
  const stored: Partial<StoredSecrets> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const token = newAdminToken();
  stored.adminTokenHash = sha256(token);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return token;
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function safeEqual(a: string, b: string): boolean {
  // HMAC both sides so lengths match and timing doesn't leak the length either.
  const key = randomBytes(16);
  const ha = createHmac("sha256", key).update(a).digest();
  const hb = createHmac("sha256", key).update(b).digest();
  return timingSafeEqual(ha, hb);
}

const token = () => randomBytes(24).toString("base64url");

/**
 * Loads DATA_DIR/secrets.json, creating it on first run. Env-provided password /
 * token always win over stored values (and are never written to disk in clear).
 */
export function loadSecrets(
  dataDir: string,
  env: { password?: string; ingestToken?: string; adminToken?: string },
): SecretsResult {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "secrets.json");
  const stored: Partial<StoredSecrets> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const generated: SecretsResult["generated"] = {};

  let changed = false;
  if (!stored.sessionSecret) {
    stored.sessionSecret = randomBytes(32).toString("hex");
    changed = true;
  }
  if (!env.ingestToken && !stored.ingestToken) {
    stored.ingestToken = token();
    generated.ingestToken = stored.ingestToken;
    changed = true;
  }
  if (!env.adminToken && !stored.adminTokenHash) {
    const admin = newAdminToken();
    stored.adminTokenHash = sha256(admin);
    generated.adminToken = admin;
    changed = true;
  }
  if (changed) writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });

  return {
    secrets: {
      sessionSecret: stored.sessionSecret,
      ingestToken: env.ingestToken ?? stored.ingestToken!,
      ...(env.password ? { passwordHash: hashPassword(env.password) } : stored.passwordHash ? { passwordHash: stored.passwordHash } : {}),
      adminTokenHash: env.adminToken ? sha256(env.adminToken) : stored.adminTokenHash!,
    },
    generated,
  };
}

export interface Session {
  /**
   * For a person this is a placeholder ("member"): their current role is looked
   * up in the users store on every request, so demotions apply at once.
   */
  role: Role;
  /** For viewers: the display link that let them in (revoking it ends the session). */
  displayId?: string;
  /** For people: who logged in (removing them ends the session). */
  userId?: string;
}

/**
 * Cookie value: `<body>.<hmac>`, where body is
 *  - `<expiry ms>` for the admin token / old password (the original format, so existing cookies stay valid),
 *  - `<expiry ms>~viewer~<display id>` for a screen logged in with a TV code,
 *  - `<expiry ms>~user~<user id>` for a person logged in with their name and token.
 * Stateless; rotating sessionSecret logs everyone out.
 */
export function signSession(secret: string, expiresAt: number, who?: { displayId: string } | { userId: string }): string {
  const body = !who ? String(expiresAt) : "displayId" in who ? `${expiresAt}~viewer~${who.displayId}` : `${expiresAt}~user~${who.userId}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** The session in a cookie value, or undefined if it's missing, forged or expired. */
export function readSession(secret: string, value: string | undefined, now = Date.now()): Session | undefined {
  if (!value) return undefined;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const m = /^(\d+)(?:~(viewer|user)~([A-Za-z0-9-]{1,64}))?$/.exec(body);
  if (!m || !sig) return undefined;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return undefined;
  if (Number(m[1]) <= now) return undefined;
  if (m[2] === "viewer") return { role: "viewer", displayId: m[3]! };
  if (m[2] === "user") return { role: "member", userId: m[3]! };
  return { role: "admin" };
}

export function verifySession(secret: string, value: string | undefined, now = Date.now()): boolean {
  return readSession(secret, value, now) !== undefined;
}
