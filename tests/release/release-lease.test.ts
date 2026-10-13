import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  consumeReleaseLease,
  issueReleaseLease,
  verifyReleaseLease,
  type LeaseVerificationContext,
  type ReplayStore,
  type ReleaseLeaseClaims,
  type SignedReleaseLease,
} from '../../src/core/release/release-lease';

class MemoryReplayStore implements ReplayStore {
  private readonly used = new Set<string>();
  reads = 0;
  consumptions = 0;

  async has(leaseId: string) {
    this.reads++;
    return this.used.has(leaseId);
  }

  async consumeIfUnused(leaseId: string) {
    this.consumptions++;
    if (this.used.has(leaseId)) return false;
    this.used.add(leaseId);
    return true;
  }
}

describe('proof-carrying release lease', () => {
  it('binds authorization to exact code, policy, evidence and environment', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const now = new Date('2026-09-27T00:00:00Z');

    const lease = issueReleaseLease(
      privateKey,
      {
        repository: 'acme/billing',
        baseSha: 'base-123',
        patchSha: 'patch-456',
        policyHash: 'policy-789',
        evidenceRoot: 'evidence-abc',
        environment: 'production',
        expiresAt: '2026-09-27T00:10:00Z',
      },
      now,
    );

    const store = new MemoryReplayStore();
    const context = {
      repository: 'acme/billing',
      baseSha: 'base-123',
      patchSha: 'patch-456',
      policyHash: 'policy-789',
      evidenceRoot: 'evidence-abc',
      environment: 'production',
      now: new Date('2026-09-27T00:01:00Z'),
    };

    expect(
      (await consumeReleaseLease(lease, publicKey, context, store)).valid,
    ).toBe(true);

    const replay = await consumeReleaseLease(
      lease,
      publicKey,
      context,
      store,
    );

    expect(replay.valid).toBe(false);
    expect(replay.reasons).toContain('lease replay detected');
  });

  it('fails closed when base HEAD moves', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(
      privateKey,
      {
        repository: 'acme/billing',
        baseSha: 'base-123',
        patchSha: 'patch-456',
        policyHash: 'policy-789',
        evidenceRoot: 'evidence-abc',
        environment: 'production',
        expiresAt: '2026-09-27T00:10:00Z',
      },
      new Date('2026-09-27T00:00:00Z'),
    );

    const store = new MemoryReplayStore();
    const result = await consumeReleaseLease(
      lease,
      publicKey,
      {
        repository: 'acme/billing',
        baseSha: 'base-MOVED',
        patchSha: 'patch-456',
        policyHash: 'policy-789',
        evidenceRoot: 'evidence-abc',
        environment: 'production',
        now: new Date('2026-09-27T00:01:00Z'),
      },
      store,
    );

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('base HEAD moved');
  });
});

const leaseInput = {
  repository: 'acme/billing',
  baseSha: 'base-123',
  patchSha: 'patch-456',
  policyHash: 'policy-789',
  evidenceRoot: 'evidence-abc',
  environment: 'production',
  expiresAt: '2026-09-27T00:10:00Z',
};

function verificationContext(): LeaseVerificationContext {
  return {
    repository: 'acme/billing',
    baseSha: 'base-123',
    patchSha: 'patch-456',
    policyHash: 'policy-789',
    evidenceRoot: 'evidence-abc',
    environment: 'production',
    now: new Date('2026-09-27T00:01:00Z'),
  };
}

// Sign adversarial claims directly: the verifier must enforce its own policy
// even when an issuer outside this process signed the malformed payload.
function signedClaims(privateKey: KeyObject, claims: Record<string, unknown>) {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(claims).sort(([a], [b]) => a.localeCompare(b))),
  );
  return {
    claims,
    algorithm: 'Ed25519',
    signature: sign(null, Buffer.from(canonical), privateKey).toString('base64url'),
  } as SignedReleaseLease;
}

describe('release lease validation before replay access', () => {
  async function rejectWithoutUsingLease(
    invalidLease: unknown,
    validLease: SignedReleaseLease,
    publicKey: KeyObject | string,
    validPublicKey: KeyObject,
    context = verificationContext(),
  ) {
    const store = new MemoryReplayStore();
    const result = await consumeReleaseLease(
      invalidLease as SignedReleaseLease,
      publicKey,
      context,
      store,
    );

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(store.reads).toBe(0);
    expect(store.consumptions).toBe(0);
    expect(
      (await consumeReleaseLease(validLease, validPublicKey, verificationContext(), store)).valid,
    ).toBe(true);
  }

  const malformedEnvelopes: [string, (lease: SignedReleaseLease) => unknown][] = [
    ['null envelope', () => null],
    ['missing envelope', () => undefined],
    ['array envelope', () => []],
    ['string envelope', () => 'signed-lease'],
    ['missing claims', (lease) => ({ algorithm: lease.algorithm, signature: lease.signature })],
    ['null claims', (lease) => ({ ...lease, claims: null })],
    ['array claims', (lease) => ({ ...lease, claims: [] })],
    ['missing algorithm', (lease) => ({ claims: lease.claims, signature: lease.signature })],
    ['unsupported algorithm', (lease) => ({ ...lease, algorithm: 'RSA' })],
    ['missing signature', (lease) => ({ claims: lease.claims, algorithm: lease.algorithm })],
    ['non-string signature', (lease) => ({ ...lease, signature: 17 })],
  ];

  it.each(malformedEnvelopes)('rejects %s without reading or consuming replay state', async (_, malformed) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(malformed(lease), lease, publicKey, publicKey);
  });

  const requiredClaims: (keyof ReleaseLeaseClaims)[] = [
    'leaseId', 'repository', 'baseSha', 'patchSha', 'policyHash', 'evidenceRoot',
    'environment', 'issuedAt', 'expiresAt', 'nonce',
  ];

  it.each(requiredClaims)('rejects a correctly signed missing %s claim', async (field) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    const claims: Record<string, unknown> = { ...lease.claims };
    delete claims[field];
    await rejectWithoutUsingLease(signedClaims(privateKey, claims), lease, publicKey, publicKey);
  });

  it.each(requiredClaims)('rejects a correctly signed blank %s claim', async (field) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(
      signedClaims(privateKey, { ...lease.claims, [field]: ' ' }), lease, publicKey, publicKey,
    );
  });

  it.each(requiredClaims)('rejects a correctly signed non-string %s claim', async (field) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(
      signedClaims(privateKey, { ...lease.claims, [field]: 7 }), lease, publicKey, publicKey,
    );
  });

  it.each([undefined, 'archeagent.release.v2', 1])('rejects correctly signed unsupported version %s', async (version) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    const claims: Record<string, unknown> = { ...lease.claims, version };
    if (version === undefined) delete claims.version;
    await rejectWithoutUsingLease(signedClaims(privateKey, claims), lease, publicKey, publicKey);
  });

  const invalidTimes: [string, Partial<ReleaseLeaseClaims>][] = [
    ['invalid issue time', { issuedAt: 'invalid' }],
    ['invalid expiry time', { expiresAt: 'invalid' }],
    ['non-ISO issue time', { issuedAt: 'September 27, 2026 00:00:00 GMT' }],
    ['non-ISO expiry time', { expiresAt: 'September 27, 2026 00:10:00 GMT' }],
    ['timezone-free issue time', { issuedAt: '2026-09-27T00:00:00' }],
    ['timezone-free expiry time', { expiresAt: '2026-09-27T00:10:00' }],
    ['impossible calendar date', { issuedAt: '2026-02-30T00:00:00Z' }],
    ['future issue time', { issuedAt: '2026-09-27T00:02:00Z' }],
    ['equal issue and expiry', { expiresAt: '2026-09-27T00:00:00Z' }],
    ['inverted lifetime', { expiresAt: '2026-09-26T23:59:59Z' }],
    ['expired authorization', { expiresAt: '2026-09-27T00:00:30Z' }],
    ['authorization at expiry boundary', { expiresAt: '2026-09-27T00:01:00Z' }],
    ['overlong declared lifetime', { expiresAt: '2026-09-27T00:15:00.001Z' }],
  ];

  it.each(invalidTimes)('rejects correctly signed %s before replay access', async (_, times) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(
      signedClaims(privateKey, { ...lease.claims, ...times }), lease, publicKey, publicKey,
    );
  });

  it.each([new Date(NaN), '2026-09-27T00:01:00Z', undefined])('rejects invalid context time %s before replay access', async (now) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(
      lease, lease, publicKey, publicKey,
      { ...verificationContext(), now } as LeaseVerificationContext,
    );
  });

  const bindings: (keyof Omit<LeaseVerificationContext, 'now'>)[] = [
    'repository', 'baseSha', 'patchSha', 'policyHash', 'evidenceRoot', 'environment',
  ];

  it.each(bindings)('rejects changed %s binding before replay access', async (field) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(
      lease, lease, publicKey, publicKey, { ...verificationContext(), [field]: 'changed' },
    );
  });

  it.each(['not a PEM key', null, {}])('returns invalid for malformed trusted key %s', async (publicKey) => {
    const keys = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(keys.privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(
      lease, lease, publicKey as KeyObject | string, keys.publicKey,
    );
  });

  it.each(['', 'not+base64/url!', `${'A'.repeat(86)}=`, 'A'.repeat(85), 'A'.repeat(86)])('rejects malformed or invalid signature %s', async (signature) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease({ ...lease, signature }, lease, publicKey, publicKey);
  });

  it('rejects an attacker signature with the server-selected key', async () => {
    const trusted = generateKeyPairSync('ed25519');
    const attacker = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(trusted.privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'));
    await rejectWithoutUsingLease(
      signedClaims(attacker.privateKey, lease.claims), lease, trusted.publicKey, trusted.publicKey,
    );
  });
});

describe('release lease issuance limits', () => {
  it('issues and verifies a lease with exactly fifteen minutes of declared lifetime', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(
      privateKey, { ...leaseInput, expiresAt: '2026-09-27T00:15:00Z' },
      new Date('2026-09-27T00:00:00Z'),
    );
    expect((await verifyReleaseLease(lease, publicKey, verificationContext())).valid).toBe(true);
  });

  it.each([
    '2026-09-27T00:15:00.001Z',
    '2026-09-27T00:00:00Z',
    '2026-09-26T23:59:59Z',
    'September 27, 2026 00:10:00 GMT',
    'invalid',
  ])('refuses to issue an invalid or overlong expiry %s', (expiresAt) => {
    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() => issueReleaseLease(
      privateKey, { ...leaseInput, expiresAt }, new Date('2026-09-27T00:00:00Z'),
    )).toThrow();
  });

  it.each(['repository', 'baseSha', 'patchSha', 'policyHash', 'evidenceRoot', 'environment'] as const)(
    'refuses to issue a lease with a blank %s', (field) => {
      const { privateKey } = generateKeyPairSync('ed25519');
      expect(() => issueReleaseLease(
        privateKey, { ...leaseInput, [field]: ' ' }, new Date('2026-09-27T00:00:00Z'),
      )).toThrow();
    },
  );

  it('refuses to issue a lease with invalid current time', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    expect(() => issueReleaseLease(privateKey, leaseInput, new Date(NaN))).toThrow();
  });
});


describe('release lease replay concurrency', () => {
  it('consumes the verified lease ID when caller input changes during replay lookup', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(
      privateKey, leaseInput, new Date('2026-09-27T00:00:00Z'),
    );
    const signedLeaseId = lease.claims.leaseId;
    let releaseLookup!: () => void;
    const lookupGate = new Promise<void>((resolve) => { releaseLookup = resolve; });
    class DelayedReplayStore extends MemoryReplayStore {
      async has(leaseId: string) {
        const used = await super.has(leaseId);
        await lookupGate;
        return used;
      }
    }
    const store = new DelayedReplayStore();
    const pending = consumeReleaseLease(lease, publicKey, verificationContext(), store);

    lease.claims.leaseId = 'unsigned-replacement-id';
    releaseLookup();
    expect((await pending).valid).toBe(true);
    expect(await store.has(signedLeaseId)).toBe(true);
    expect(await store.has('unsigned-replacement-id')).toBe(false);

    lease.claims.leaseId = signedLeaseId;
    expect((await consumeReleaseLease(lease, publicKey, verificationContext(), store)).valid).toBe(false);
  });

  it('atomically allows only one concurrent lease consumption', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const lease = issueReleaseLease(
      privateKey,
      {
        repository: 'acme/billing',
        baseSha: 'base-123',
        patchSha: 'patch-456',
        policyHash: 'policy-789',
        evidenceRoot: 'evidence-abc',
        environment: 'production',
        expiresAt: '2026-09-27T00:10:00Z',
      },
      new Date('2026-09-27T00:00:00Z'),
    );
    const context = {
      repository: 'acme/billing',
      baseSha: 'base-123',
      patchSha: 'patch-456',
      policyHash: 'policy-789',
      evidenceRoot: 'evidence-abc',
      environment: 'production',
      now: new Date('2026-09-27T00:01:00Z'),
    };
    const store = new MemoryReplayStore();

    const results = await Promise.all([
      consumeReleaseLease(lease, publicKey, context, store),
      consumeReleaseLease(lease, publicKey, context, store),
    ]);

    expect(results.filter((result) => result.valid)).toHaveLength(1);
    expect(results.filter((result) => !result.valid)).toHaveLength(1);
    expect(results.find((result) => !result.valid)?.reasons).toContain(
      'lease replay detected',
    );
  });
});
