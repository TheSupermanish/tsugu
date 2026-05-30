import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import prompts from "prompts";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

/**
 * Encrypted, non-custodial key store for the tsugu CLI.
 *
 * Your private key is encrypted with a password you choose (scrypt → AES-256-GCM)
 * and written to ~/.tsugu/keystore.json. The plaintext key never touches disk and
 * is never sent anywhere — this runs entirely on your machine. Wrong password =
 * the GCM auth check fails and decryption throws. Same pattern as `cast wallet`.
 */

export const TSUGU_HOME = process.env.TSUGU_HOME || join(homedir(), ".tsugu");
const KEYSTORE_PATH = join(TSUGU_HOME, "keystore.json");

type Hex = `0x${string}`;

interface KeystoreFile {
  version: 1;
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  address: Address;
}

const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_N_FLOOR = 1 << 14; // reject keystores weakened below this on load

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, 32, { N: n, r, p, maxmem: 128 * n * r * 2 });
}

export function hasKeystore(): boolean {
  return existsSync(KEYSTORE_PATH);
}

export function keystoreAddress(): Address | null {
  if (!hasKeystore()) return null;
  try {
    return (JSON.parse(readFileSync(KEYSTORE_PATH, "utf8")) as KeystoreFile).address;
  } catch {
    return null;
  }
}

export function saveKeystore(privateKey: Hex, password: string): Address {
  const address = privateKeyToAccount(privateKey).address;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const file: KeystoreFile = {
    version: 1,
    kdf: "scrypt",
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    address,
  };

  if (!existsSync(TSUGU_HOME)) mkdirSync(TSUGU_HOME, { recursive: true, mode: 0o700 });
  writeFileSync(KEYSTORE_PATH, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  return address;
}

/** Decrypt the keystore. Throws "wrong password" on a bad password, or
 *  "corrupt keystore" if the file's fields are tampered/malformed. */
export function loadKeystore(password: string): Hex {
  const file = JSON.parse(readFileSync(KEYSTORE_PATH, "utf8")) as KeystoreFile;
  const salt = Buffer.from(file.salt, "hex");
  const iv = Buffer.from(file.iv, "hex");
  const tag = Buffer.from(file.tag, "hex");

  // Validate field shapes before trusting them. A short/forged GCM tag would
  // weaken integrity, and a downgraded scrypt N would weaken brute-force
  // resistance — the keystore is a plaintext file, so don't trust it blindly.
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) {
    throw new Error("corrupt keystore (bad salt/iv/tag length)");
  }
  if (
    file.kdf !== "scrypt" ||
    !(file.n >= SCRYPT_N_FLOOR) ||
    !(file.r >= 1 && file.r <= 32) ||
    !(file.p >= 1 && file.p <= 16)
  ) {
    throw new Error("corrupt keystore (unsupported or weakened KDF params)");
  }

  // Use the file's own params so future N bumps stay readable.
  const key = deriveKey(password, salt, file.n, file.r, file.p);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(Buffer.from(file.ciphertext, "hex")), decipher.final()]);
    return plaintext.toString("utf8") as Hex;
  } catch {
    throw new Error("wrong password");
  }
}

export function removeKeystore(): void {
  if (hasKeystore()) rmSync(KEYSTORE_PATH);
}

/** Prompt for input; `hidden` masks it. `trim` defaults true, but pass false for
 *  secrets — trimming a password silently changes it and can lock you out of a
 *  keystore restored elsewhere. Uses `prompts` for TTY masking + Ctrl-C handling. */
export async function prompt(question: string, hidden = false, trim = true): Promise<string> {
  const { value } = await prompts(
    { type: hidden ? "password" : "text", name: "value", message: question.trim() },
    { onCancel: () => process.exit(1) },
  );
  const s = String(value ?? "");
  return trim ? s.trim() : s;
}
