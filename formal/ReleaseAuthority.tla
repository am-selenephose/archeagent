------------------------- MODULE ReleaseAuthority -------------------------
EXTENDS Naturals, Integers, TLC

CONSTANTS MaxRetries, MaxBudget, MaxReplayAttempts

Versions == 0..1
RiskLevels == {"low", "high"}
AuthorityLevels == {"SHADOW", "PROPOSE", "LOW", "MEDIUM"}

VARIABLES
  risk,
  evidenceReady,
  humanApproved,
  calibrated,
  authority,
  baseV,
  patchV,
  policyV,
  evidenceV,
  environmentV,
  leaseIssued,
  leaseConsumed,
  expired,
  leaseBaseV,
  leasePatchV,
  leasePolicyV,
  leaseEvidenceV,
  leaseEnvironmentV,
  retries,
  budget,
  released,
  releaseCount,
  replayAttempts

vars ==
  << risk,
     evidenceReady,
     humanApproved,
     calibrated,
     authority,
     baseV,
     patchV,
     policyV,
     evidenceV,
     environmentV,
     leaseIssued,
     leaseConsumed,
     expired,
     leaseBaseV,
     leasePatchV,
     leasePolicyV,
     leaseEvidenceV,
     leaseEnvironmentV,
     retries,
     budget,
     released,
     releaseCount,
     replayAttempts >>

TypeOK ==
  /\ risk \in RiskLevels
  /\ evidenceReady \in BOOLEAN
  /\ humanApproved \in BOOLEAN
  /\ calibrated \in BOOLEAN
  /\ authority \in AuthorityLevels
  /\ baseV \in Versions
  /\ patchV \in Versions
  /\ policyV \in Versions
  /\ evidenceV \in Versions
  /\ environmentV \in Versions
  /\ leaseIssued \in BOOLEAN
  /\ leaseConsumed \in BOOLEAN
  /\ expired \in BOOLEAN
  /\ leaseBaseV \in Versions \cup {-1}
  /\ leasePatchV \in Versions \cup {-1}
  /\ leasePolicyV \in Versions \cup {-1}
  /\ leaseEvidenceV \in Versions \cup {-1}
  /\ leaseEnvironmentV \in Versions \cup {-1}
  /\ retries \in 0..MaxRetries
  /\ budget \in 0..MaxBudget
  /\ released \in BOOLEAN
  /\ releaseCount \in 0..1
  /\ replayAttempts \in 0..MaxReplayAttempts

Init ==
  /\ risk \in RiskLevels
  /\ evidenceReady = FALSE
  /\ humanApproved = FALSE
  /\ calibrated = FALSE
  /\ authority = "SHADOW"
  /\ baseV = 0
  /\ patchV = 0
  /\ policyV = 0
  /\ evidenceV = 0
  /\ environmentV = 0
  /\ leaseIssued = FALSE
  /\ leaseConsumed = FALSE
  /\ expired = FALSE
  /\ leaseBaseV = -1
  /\ leasePatchV = -1
  /\ leasePolicyV = -1
  /\ leaseEvidenceV = -1
  /\ leaseEnvironmentV = -1
  /\ retries = 0
  /\ budget = MaxBudget
  /\ released = FALSE
  /\ releaseCount = 0
  /\ replayAttempts = 0

GatherEvidence ==
  /\ ~released
  /\ ~evidenceReady
  /\ evidenceReady' = TRUE
  /\ UNCHANGED << risk, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

ApproveHuman ==
  /\ ~released
  /\ ~humanApproved
  /\ humanApproved' = TRUE
  /\ UNCHANGED << risk, evidenceReady, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

Calibrate ==
  /\ ~released
  /\ ~calibrated
  /\ calibrated' = TRUE
  /\ UNCHANGED << risk, evidenceReady, humanApproved, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

PromoteToPropose ==
  /\ ~released
  /\ calibrated
  /\ authority = "SHADOW"
  /\ authority' = "PROPOSE"
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

PromoteToLow ==
  /\ ~released
  /\ calibrated
  /\ authority = "PROPOSE"
  /\ authority' = "LOW"
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

PromoteToMedium ==
  /\ ~released
  /\ calibrated
  /\ authority = "LOW"
  /\ authority' = "MEDIUM"
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

IssueLease ==
  /\ ~released
  /\ ~leaseIssued
  /\ evidenceReady
  /\ calibrated
  /\ authority # "SHADOW"
  /\ (risk = "low" \/ humanApproved)
  /\ budget > 0
  /\ leaseIssued' = TRUE
  /\ leaseBaseV' = baseV
  /\ leasePatchV' = patchV
  /\ leasePolicyV' = policyV
  /\ leaseEvidenceV' = evidenceV
  /\ leaseEnvironmentV' = environmentV
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseConsumed, expired, retries, budget,
                  released, releaseCount, replayAttempts >>

DriftBase ==
  /\ ~released
  /\ baseV = 0
  /\ baseV' = 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

DriftPatch ==
  /\ ~released
  /\ patchV = 0
  /\ patchV' = 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

DriftPolicy ==
  /\ ~released
  /\ policyV = 0
  /\ policyV' = 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

DriftEvidence ==
  /\ ~released
  /\ evidenceV = 0
  /\ evidenceV' = 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

DriftEnvironment ==
  /\ ~released
  /\ environmentV = 0
  /\ environmentV' = 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

ExpireLease ==
  /\ ~released
  /\ leaseIssued
  /\ ~expired
  /\ expired' = TRUE
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount, replayAttempts >>

Retry ==
  /\ ~released
  /\ retries < MaxRetries
  /\ budget > 0
  /\ retries' = retries + 1
  /\ budget' = budget - 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  released, releaseCount, replayAttempts >>

ExactLeaseBinding ==
  /\ leaseBaseV = baseV
  /\ leasePatchV = patchV
  /\ leasePolicyV = policyV
  /\ leaseEvidenceV = evidenceV
  /\ leaseEnvironmentV = environmentV

CanRelease ==
  /\ evidenceReady
  /\ calibrated
  /\ authority # "SHADOW"
  /\ (risk = "low" \/ humanApproved)
  /\ leaseIssued
  /\ ~leaseConsumed
  /\ ~expired
  /\ ExactLeaseBinding

Release ==
  /\ ~released
  /\ releaseCount = 0
  /\ CanRelease
  /\ released' = TRUE
  /\ leaseConsumed' = TRUE
  /\ releaseCount' = releaseCount + 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, replayAttempts >>

ReplayAttempt ==
  /\ leaseConsumed
  /\ replayAttempts < MaxReplayAttempts
  /\ replayAttempts' = replayAttempts + 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, leaseConsumed, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, released, releaseCount >>

NoOp ==
  UNCHANGED vars

Next ==
  \/ GatherEvidence
  \/ ApproveHuman
  \/ Calibrate
  \/ PromoteToPropose
  \/ PromoteToLow
  \/ PromoteToMedium
  \/ IssueLease
  \/ DriftBase
  \/ DriftPatch
  \/ DriftPolicy
  \/ DriftEvidence
  \/ DriftEnvironment
  \/ ExpireLease
  \/ Retry
  \/ Release
  \/ ReplayAttempt
  \/ NoOp

Spec == Init /\ [][Next]_vars

\* Negative control: models a realistic verifier bug that forgets to
\* fence release authority to the exact base commit captured by the lease.
UnsafeReleaseIgnoresBase ==
  /\ ~released
  /\ releaseCount = 0
  /\ evidenceReady
  /\ calibrated
  /\ authority # "SHADOW"
  /\ (risk = "low" \/ humanApproved)
  /\ leaseIssued
  /\ ~leaseConsumed
  /\ ~expired
  /\ leasePatchV = patchV
  /\ leasePolicyV = policyV
  /\ leaseEvidenceV = evidenceV
  /\ leaseEnvironmentV = environmentV
  /\ released' = TRUE
  /\ leaseConsumed' = TRUE
  /\ releaseCount' = releaseCount + 1
  /\ UNCHANGED << risk, evidenceReady, humanApproved, calibrated, authority,
                  baseV, patchV, policyV, evidenceV, environmentV,
                  leaseIssued, expired,
                  leaseBaseV, leasePatchV, leasePolicyV,
                  leaseEvidenceV, leaseEnvironmentV,
                  retries, budget, replayAttempts >>

UnsafeNext ==
  \/ GatherEvidence
  \/ ApproveHuman
  \/ Calibrate
  \/ PromoteToPropose
  \/ PromoteToLow
  \/ PromoteToMedium
  \/ IssueLease
  \/ DriftBase
  \/ DriftPatch
  \/ DriftPolicy
  \/ DriftEvidence
  \/ DriftEnvironment
  \/ ExpireLease
  \/ Retry
  \/ UnsafeReleaseIgnoresBase
  \/ ReplayAttempt
  \/ NoOp

UnsafeSpec == Init /\ [][UnsafeNext]_vars

ReleaseRequiresEvidence ==
  released => evidenceReady

HighRiskLeaseRequiresHumanApproval ==
  (leaseIssued /\ risk = "high") => humanApproved

ReleaseRequiresCalibration ==
  released => calibrated

ReleaseRequiresAuthority ==
  released => authority # "SHADOW"

ReleaseRequiresLiveLease ==
  released => (leaseIssued /\ leaseConsumed /\ ~expired)

ReleaseBindsExactState ==
  released => ExactLeaseBinding

SingleUseRelease ==
  releaseCount <= 1

ConsumedLeaseHasExactlyOneRelease ==
  leaseConsumed => releaseCount = 1

RetryBounded ==
  retries <= MaxRetries

BudgetNonNegative ==
  budget >= 0

AuthorityPromotionRequiresCalibration ==
  authority # "SHADOW" => calibrated

=============================================================================
