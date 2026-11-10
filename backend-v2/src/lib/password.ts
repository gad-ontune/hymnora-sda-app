import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { badRequest } from "./errors.ts";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * A syntactically valid stand-in hash for an account that does not exist, so
 * the login path still pays the full scrypt cost either way.
 *
 * A malformed placeholder (`scrypt$00$00`) returns before the KDF runs, and a
 * login that answers in microseconds instead of milliseconds tells an attacker
 * which emails are registered.
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${randomBytes(SALT_LENGTH).toString("hex")}$${"0".repeat(KEY_LENGTH * 2)}`;

/** Hashes a password with scrypt: `scrypt$<salt-hex>$<hash-hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Constant-time password verification. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length !== KEY_LENGTH) return false;
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}

/** Basic strength check — enough to reject obvious junk at the edge. */
export function assertPasswordStrength(password: string): void {
  const problems: string[] = [];
  if (password.length < 8) problems.push("at least 8 characters");
  if (!/[a-z]/i.test(password)) problems.push("a letter");
  if (!/\d/.test(password)) problems.push("a number");
  if (problems.length > 0) {
    throw badRequest(`Password must contain ${problems.join(", ")}`);
  }
}
