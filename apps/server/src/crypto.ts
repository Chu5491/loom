// AES-256-GCM symmetric encryption for secrets at rest.
// Key file auto-generated at dataDir/.encryption-key on first use.

import { exec } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "enc:";

const keyPath = path.join(config.dataDir, ".encryption-key");

let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;
  try {
    const buf = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "hex");
    if (buf.length !== 32) {
      throw new Error(`encryption key at ${keyPath} is corrupt (expected 32 bytes, got ${buf.length})`);
    }
    _key = buf;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // File does not exist — generate. Use 'wx' flag for exclusive create
    // so two concurrent processes cannot both write different keys.
    const newKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(keyPath, newKey.toString("hex") + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    } catch (writeErr) {
      if ((writeErr as NodeJS.ErrnoException).code === "EEXIST") {
        // Another process won the race — read its key instead.
        return getKey();
      }
      throw writeErr;
    }
    if (process.platform === "win32") {
      exec(`icacls "${keyPath}" /inheritance:r /grant:r "%USERNAME%:F"`);
    }
    _key = newKey;
  }
  return _key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]);
  return PREFIX + payload.toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = getKey();
  const payload = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_LEN);
  const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = payload.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

/** Returns null on decrypt failure (corrupt data, key rotation). */
export function tryDecryptSecret(stored: string): string | null {
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** For tests only. */
export function _resetKeyCache(): void {
  _key = null;
}
