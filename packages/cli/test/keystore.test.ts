import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// keystore.ts captures TSUGU_HOME at import time — set it, then dynamic-import once.
const home = mkdtempSync(join(tmpdir(), "tsugu-ks-"));
let ks: typeof import("../src/keystore.js");

beforeAll(async () => {
  process.env.TSUGU_HOME = home;
  ks = await import("../src/keystore.js");
});
beforeEach(() => {
  try {
    ks.removeKeystore();
  } catch {
    /* none */
  }
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const keystorePath = () => join(home, "keystore.json");

describe("keystore", () => {
  it("round-trips a key with the right password", () => {
    const pk = generatePrivateKey();
    const addr = ks.saveKeystore(pk, "correct horse battery");
    expect(addr).toBe(privateKeyToAccount(pk).address);
    expect(ks.loadKeystore("correct horse battery")).toBe(pk);
  });

  it("rejects the wrong password", () => {
    ks.saveKeystore(generatePrivateKey(), "right-password");
    expect(() => ks.loadKeystore("wrong-password")).toThrow(/wrong password/);
  });

  it("does NOT trim passwords (leading/trailing spaces are significant)", () => {
    const pk = generatePrivateKey();
    ks.saveKeystore(pk, "  spaced pass  ");
    expect(ks.loadKeystore("  spaced pass  ")).toBe(pk);
    expect(() => ks.loadKeystore("spaced pass")).toThrow(/wrong password/);
  });

  it("rejects a truncated GCM auth tag (integrity floor)", () => {
    ks.saveKeystore(generatePrivateKey(), "pw-pw-pw-pw");
    const f = JSON.parse(readFileSync(keystorePath(), "utf8"));
    f.tag = f.tag.slice(0, 8); // 4-byte tag
    writeFileSync(keystorePath(), JSON.stringify(f));
    expect(() => ks.loadKeystore("pw-pw-pw-pw")).toThrow(/corrupt keystore/);
  });

  it("rejects a downgraded scrypt N", () => {
    ks.saveKeystore(generatePrivateKey(), "pw-pw-pw-pw");
    const f = JSON.parse(readFileSync(keystorePath(), "utf8"));
    f.n = 2;
    writeFileSync(keystorePath(), JSON.stringify(f));
    expect(() => ks.loadKeystore("pw-pw-pw-pw")).toThrow(/corrupt keystore/);
  });

  it("writes the keystore with 0600 permissions", () => {
    ks.saveKeystore(generatePrivateKey(), "pw-pw-pw-pw");
    expect(statSync(keystorePath()).mode & 0o777).toBe(0o600);
  });
});
