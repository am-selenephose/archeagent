import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import receipt from "../../formal/receipts/release-authority-summary.json";
import {
  assertFormalReceiptFresh,
  computeFormalInputHashes,
} from "../../src/core/formal-receipt";

const inputs = {
  spec: readFileSync("formal/ReleaseAuthority.tla"),
  safeConfig: readFileSync("formal/ReleaseAuthority.cfg"),
  negativeConfig: readFileSync("formal/ReleaseAuthorityUnsafe.cfg"),
};

describe("formal receipt integrity", () => {
  it("binds the checked-in receipt to the exact formal inputs", () => {
    expect(computeFormalInputHashes(inputs)).toEqual(receipt.inputs);
    expect(() => assertFormalReceiptFresh(receipt, inputs)).not.toThrow();
  });

  it("rejects a receipt after the formal specification drifts", () => {
    const drifted = {
      ...inputs,
      spec: Buffer.concat([inputs.spec, Buffer.from("\n\\* drift\n")]),
    };

    expect(() => assertFormalReceiptFresh(receipt, drifted)).toThrow(
      /spec_sha256 mismatch/,
    );
  });
});
