import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

export type ReleaseLeaseClaims = {
  version: 'archeagent.release.v1';
  leaseId: string;
  repository: string;
  baseSha: string;
  patchSha: string;
  policyHash: string;
  evidenceRoot: string;
  environment: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
};

export type SignedReleaseLease = {
  claims: ReleaseLeaseClaims;
  algorithm: 'Ed25519';
  signature: string;
};

export type LeaseVerificationContext = {
  repository: string;
  baseSha: string;
  patchSha: string;
  policyHash: string;
  evidenceRoot: string;
  environment: string;
  now: Date;
};

export interface ReplayStore {
  has(leaseId: string): Promise<boolean>;
  consumeIfUnused(leaseId: string): Promise<boolean>;
}

function canonicalJson(claims: ReleaseLeaseClaims) {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(claims).sort()) {
    ordered[key] = claims[key as keyof ReleaseLeaseClaims];
  }
  return JSON.stringify(ordered);
}

export function issueReleaseLease(
  privateKey: KeyObject | string,
  input: Omit<
    ReleaseLeaseClaims,
    'version' | 'leaseId' | 'issuedAt' | 'nonce'
  >,
  now = new Date(),
): SignedReleaseLease {
  const claims: ReleaseLeaseClaims = {
    version: 'archeagent.release.v1',
    leaseId: randomUUID(),
    issuedAt: now.toISOString(),
    nonce: randomUUID(),
    ...input,
  };

  const key =
    typeof privateKey === 'string'
      ? createPrivateKey(privateKey)
      : privateKey;

  const signature = sign(
    null,
    Buffer.from(canonicalJson(claims)),
    key,
  ).toString('base64url');

  return {
    claims,
    algorithm: 'Ed25519',
    signature,
  };
}

export async function verifyReleaseLease(
  lease: SignedReleaseLease,
  publicKey: KeyObject | string,
  context: LeaseVerificationContext,
  replayStore?: ReplayStore,
) {
  const reasons: string[] = [];
  const key =
    typeof publicKey === 'string'
      ? createPublicKey(publicKey)
      : publicKey;

  const signatureValid = verify(
    null,
    Buffer.from(canonicalJson(lease.claims)),
    key,
    Buffer.from(lease.signature, 'base64url'),
  );

  if (!signatureValid) reasons.push('signature invalid');
  if (lease.claims.repository !== context.repository)
    reasons.push('repository mismatch');
  if (lease.claims.baseSha !== context.baseSha)
    reasons.push('base HEAD moved');
  if (lease.claims.patchSha !== context.patchSha)
    reasons.push('patch changed');
  if (lease.claims.policyHash !== context.policyHash)
    reasons.push('policy drift');
  if (lease.claims.evidenceRoot !== context.evidenceRoot)
    reasons.push('evidence changed');
  if (lease.claims.environment !== context.environment)
    reasons.push('environment mismatch');
  if (context.now >= new Date(lease.claims.expiresAt))
    reasons.push('authorization expired');

  if (replayStore && (await replayStore.has(lease.claims.leaseId))) {
    reasons.push('lease replay detected');
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export async function consumeReleaseLease(
  lease: SignedReleaseLease,
  publicKey: KeyObject | string,
  context: LeaseVerificationContext,
  replayStore: ReplayStore,
) {
  const result = await verifyReleaseLease(
    lease,
    publicKey,
    context,
    replayStore,
  );

  if (!result.valid) return result;

  const consumed = await replayStore.consumeIfUnused(lease.claims.leaseId);
  if (!consumed) {
    return {
      valid: false,
      reasons: ['lease replay detected'],
    };
  }

  return result;
}
