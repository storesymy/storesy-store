import { describe, expect, it } from "vitest";
import { defaultIterations, hashPassword, verifyPassword } from "../src/services/password";

/**
 * Password hashing must stay within the Workers WebCrypto limit: PBKDF2
 * iteration counts above 100,000 throw NotSupportedError at runtime.
 */
describe("password hashing", () => {
  it("uses the Workers maximum and clamps bad overrides", () => {
    expect(defaultIterations()).toBe(100_000);
    expect(defaultIterations({ PBKDF2_ITERATIONS: "210000" } as unknown as Env)).toBe(100_000);
    expect(defaultIterations({ PBKDF2_ITERATIONS: "5000" } as unknown as Env)).toBe(10_000);
  });

  it("hashes and verifies at the supported count", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});
