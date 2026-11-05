import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "@pixel-office/protocol";

interface StoredSecrets {
  sessionSecret: string;
  ingestToken: string;
  /** `scrypt$<salt hex>$<hash hex>` */
  passwordHash: string;
  /** SHA-256 hex of the admin token (the token itself is never stored). */
  adminTokenHash: string;
}

export interface Secrets {
  sessionSecret: string;
  ingestToken: string;
  passwordHash: string;
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
  if (!env.password && !stored.passwordHash) {
    const pw = token().slice(0, 16);
    stored.passwordHash = hashPassword(pw);
    generated.password = pw;
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
      passwordHash: env.password ? hashPassword(env.password) : stored.passwordHash!,
      adminTokenHash: env.adminToken ? sha256(env.adminToken) : stored.adminTokenHash!,
    },
    generated,
  };
}

export interface Session {
  role: Role;
  /** For viewers: the display link that let them in (revoking it ends the session). */
  displayId?: string;
}

/**
 * Cookie value: `<body>.<hmac>`, where body is `<expiry ms>` for an admin
 * (the original format, so existing cookies stay valid) or
 * `<expiry ms>~viewer~<display id>` for a screen opened with a display link.
 * Stateless; rotating sessionSecret logs everyone out.
 */
export function signSession(secret: string, expiresAt: number, viewer?: { displayId: string }): string {
  const body = viewer ? `${expiresAt}~viewer~${viewer.displayId}` : String(expiresAt);
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
  const m = /^(\d+)(?:~viewer~([A-Za-z0-9-]{1,64}))?$/.exec(body);
  if (!m || !sig) return undefined;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return undefined;
  if (Number(m[1]) <= now) return undefined;
  return m[2] ? { role: "viewer", displayId: m[2] } : { role: "admin" };
}

export function verifySession(secret: string, value: string | undefined, now = Date.now()): boolean {
  return readSession(secret, value, now) !== undefined;
}
