import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import prompts from "prompts";
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";
import { toHex, type Address } from "viem";

/**
 * Encrypted, non-custodial HD keychain for the tsugu CLI.
 *
 * One BIP-39 seed (12 words) is encrypted with your password (scrypt → AES-256-GCM)
 * at ~/.tsugu/keystore.json. Every account is derived from it (BIP-44 m/44'/60'/0'/0/i):
 *   - index 0  = your funding account (pays gas to create agents)
 *   - index 1+ = each agent's own self-sovereign key
 * The plaintext seed never touches disk and is never sent anywhere — everything
 * runs on your machine. Back up the 12 words once and every agent is recoverable.
 */

export const TSUGU_HOME = process.env.TSUGU_HOME || join(homedir(), ".tsugu");
const KEYSTORE_PATH = join(TSUGU_HOME, "keystore.json");

type Hex = `0x${string}`;

interface KeystoreFile {
  version: 2;
  type: "hd-mnemonic";
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  /** index-0 address, public, so whoami/address work without unlocking. */
  address: Address;
}

const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_N_FLOOR = 1 << 14; // reject keystores weakened below this on load

function deriveScryptKey(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(password, salt, 32, { N: n, r, p, maxmem: 128 * n * r * 2 });
}

// --- HD derivation ---------------------------------------------------------

export function newMnemonic(): string {
  return generateMnemonic(english);
}

export function isValidMnemonic(mnemonic: string): boolean {
  try {
    mnemonicToAccount(mnemonic);
    return true;
  } catch {
    return false;
  }
}

/** Derive the account at a BIP-44 address index from the seed. */
export function deriveAccount(mnemonic: string, index: number): { privateKey: Hex; address: Address } {
  const account = mnemonicToAccount(mnemonic, { addressIndex: index });
  const pk = account.getHdKey().privateKey;
  if (!pk) throw new Error("failed to derive private key");
  return { privateKey: toHex(pk), address: account.address };
}

// --- keystore (encrypt the seed) -------------------------------------------

export function hasKeystore(): boolean {
  return existsSync(KEYSTORE_PATH);
}

/** Index-0 address, readable without the password (it's public metadata). */
export function operatorAddress(): Address | null {
  if (!hasKeystore()) return null;
  try {
    return (JSON.parse(readFileSync(KEYSTORE_PATH, "utf8")) as KeystoreFile).address;
  } catch {
    return null;
  }
}

export function saveSeed(mnemonic: string, password: string): Address {
  const address = deriveAccount(mnemonic, 0).address;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveScryptKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(mnemonic, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const file: KeystoreFile = {
    version: 2,
    type: "hd-mnemonic",
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

/** Decrypt the seed. Throws "wrong password" on a bad password, or
 *  "corrupt keystore" if the file's fields are tampered/malformed. */
export function loadSeed(password: string): string {
  const file = JSON.parse(readFileSync(KEYSTORE_PATH, "utf8")) as KeystoreFile;
  const salt = Buffer.from(file.salt, "hex");
  const iv = Buffer.from(file.iv, "hex");
  const tag = Buffer.from(file.tag, "hex");

  // Don't trust an on-disk file blindly: a short/forged GCM tag weakens integrity
  // and a downgraded scrypt N weakens brute-force resistance.
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

  const key = deriveScryptKey(password, salt, file.n, file.r, file.p);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(Buffer.from(file.ciphertext, "hex")), decipher.final()]);
    return plaintext.toString("utf8");
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
