import { createHash } from "node:crypto";

type FormalInputs = {
  spec: string | Buffer;
  safeConfig: string | Buffer;
  negativeConfig: string | Buffer;
};

type FormalReceipt = {
  inputs: {
    spec_sha256: string;
    safe_config_sha256: string;
    negative_config_sha256: string;
  };
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function computeFormalInputHashes(inputs: FormalInputs) {
  return {
    spec_sha256: sha256(inputs.spec),
    safe_config_sha256: sha256(inputs.safeConfig),
    negative_config_sha256: sha256(inputs.negativeConfig),
  };
}

export function assertFormalReceiptFresh(
  receipt: FormalReceipt,
  inputs: FormalInputs,
) {
  const actual = computeFormalInputHashes(inputs);

  for (const [key, value] of Object.entries(actual)) {
    const receiptValue = receipt.inputs[key as keyof typeof receipt.inputs];
    if (receiptValue !== value) {
      throw new Error(
        `formal receipt stale: ${key} mismatch (receipt=${receiptValue}, actual=${value})`,
      );
    }
  }
}
