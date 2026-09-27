# Release Authority TLA+ Model

This bounded TLA+ model checks the release-authority state machine used by Archeagent.

It models both low-risk and high-risk changes, evidence readiness, human approval, calibration, authority promotion, code/policy/evidence/environment drift, lease issuance, lease expiry, retry budget, release, consumption, and replay attempts.

Checked safety invariants include:

- no release without evidence;
- high-risk lease issuance requires human approval;
- release requires calibration and non-shadow authority;
- release requires a live, unconsumed lease;
- release remains bound to the exact base, patch, policy, evidence, and environment versions captured by the lease;
- a consumed lease corresponds to exactly one release;
- retries and budget stay bounded;
- authority cannot leave SHADOW before calibration.

This is bounded model checking, not a proof of arbitrary application correctness.

The current verification uses the official TLA+ v1.7.4 command-line tools.

Tool artifact SHA-256:

936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
