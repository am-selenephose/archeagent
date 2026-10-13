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

// Local release authorization may declare at most fifteen minutes of lifetime.
const MAX_RELEASE_LEASE_LIFETIME_MS = 15 * 60 * 1000;

const requiredClaimFields = [
  'leaseId',
  'repository',
  'baseSha',
  'patchSha',
  'policyHash',
  'evidenceRoot',
  'environment',
  'issuedAt',
  'expiresAt',
  'nonce',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dateTime(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  try {
    const time = Date.prototype.getTime.call(value);
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

function isoTimestamp(value: string): number | null {
  // Require an explicit timezone and millisecond precision at most. Round-trip
  // the local calendar fields so Date.parse cannot normalize impossible dates.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const calendar = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  const localTime = Date.parse(calendar);
  const time = Date.parse(value);
  if (
    !Number.isFinite(localTime) ||
    !Number.isFinite(time) ||
    new Date(localTime).toISOString() !== calendar
  ) return null;
  return time;
}

function validateClaims(claims: unknown, now: number): string[] {
  if (!isRecord(claims)) return ['release claims invalid'];
  if (
    !Object.hasOwn(claims, 'version') ||
    claims.version !== 'archeagent.release.v1'
  ) return ['release version unsupported'];

  for (const field of requiredClaimFields) {
    if (
      !Object.hasOwn(claims, field) ||
      typeof claims[field] !== 'string' ||
      !claims[field].trim()
    ) return [`release claim invalid: ${field}`];
  }

  const issuedAt = isoTimestamp(claims.issuedAt as string);
  const expiresAt = isoTimestamp(claims.expiresAt as string);
  if (issuedAt === null || expiresAt === null) return ['release timestamp invalid'];

  const reasons: string[] = [];
  if (issuedAt > now) reasons.push('authorization issued in future');
  if (expiresAt <= issuedAt) reasons.push('authorization lifetime invalid');
  if (expiresAt - issuedAt > MAX_RELEASE_LEASE_LIFETIME_MS)
    reasons.push('authorization lifetime exceeds fifteen minutes');
  if (expiresAt <= now) reasons.push('authorization expired');
  return reasons;
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
  const nowTime = dateTime(now);
  if (nowTime === null) throw new Error('release issuance time invalid');

  const claims: ReleaseLeaseClaims = {
    ...input,
    version: 'archeagent.release.v1',
    leaseId: randomUUID(),
    issuedAt: new Date(nowTime).toISOString(),
    nonce: randomUUID(),
  };

  const reasons = validateClaims(claims, nowTime);
  if (reasons.length) throw new Error(reasons.join('; '));

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
  const now = isRecord(context) ? dateTime(context.now) : null;
  if (now === null) return { valid: false, reasons: ['verification time invalid'] };
  if (
    !isRecord(lease) ||
    !Object.hasOwn(lease, 'claims') ||
    lease.algorithm !== 'Ed25519' ||
    typeof lease.signature !== 'string'
  ) return { valid: false, reasons: ['release envelope invalid'] };

  const reasons = validateClaims(lease.claims, now);
  if (reasons.length) return { valid: false, reasons };

  let signatureValid = false;
  try {
    const signature = Buffer.from(lease.signature, 'base64url');
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    signatureValid =
      signature.length === 64 &&
      signature.toString('base64url') === lease.signature &&
      key.asymmetricKeyType === 'ed25519' &&
      verify(null, Buffer.from(canonicalJson(lease.claims)), key, signature);
  } catch {
    // Invalid trusted-key configuration or signature parsing fails closed.
  }

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
  if (reasons.length) return { valid: false, reasons };

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
  // Keep the checked claims stable across asynchronous replay-store calls.
  const snapshot = isRecord(lease) && isRecord(lease.claims)
    ? { ...lease, claims: { ...lease.claims } }
    : lease;
  const result = await verifyReleaseLease(
    snapshot,
    publicKey,
    context,
    replayStore,
  );

  if (!result.valid) return result;

  const consumed = await replayStore.consumeIfUnused(snapshot.claims.leaseId);
  if (!consumed) {
    return {
      valid: false,
      reasons: ['lease replay detected'],
    };
  }

  return result;
}
