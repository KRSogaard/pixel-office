import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface StoredSecrets {
  sessionSecret: string;
  ingestToken: string;
  /** `scrypt$<salt hex>$<hash hex>` */
  passwordHash: string;
}

export interface Secrets {
  sessionSecret: string;
  ingestToken: string;
  passwordHash: string;
}

export interface SecretsResult {
  secrets: Secrets;
  /** Values generated on this run that the operator has never seen. Print once. */
  generated: { password?: string; ingestToken?: string };
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
export function loadSecrets(dataDir: string, env: { password?: string; ingestToken?: string }): SecretsResult {
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
  if (changed) writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });

  return {
    secrets: {
      sessionSecret: stored.sessionSecret,
      ingestToken: env.ingestToken ?? stored.ingestToken!,
      passwordHash: env.password ? hashPassword(env.password) : stored.passwordHash!,
    },
    generated,
  };
}

/** Cookie value: `<expiry ms>.<hmac>`. Stateless; rotating sessionSecret logs everyone out. */
export function signSession(secret: string, expiresAt: number): string {
  const body = String(expiresAt);
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(secret: string, value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [body, sig] = value.split(".");
  if (!body || !sig || !/^\d+$/.test(body)) return false;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
  return Number(body) > now;
}
