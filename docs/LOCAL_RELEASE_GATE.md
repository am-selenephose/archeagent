# Archeagent: Local-only until one final release

Owner decision, 2026-10-12: keep all Codex sessions, intermediate UI iterations,
MCP experiments, audit findings and candidate builds local. Do not publish
multiple intermediate branches/PRs to am-selenephose. The final public update
should contain only the reviewed final tree, not every experimental UI asset. No push, PR, merge,
deployment or recruiter-email send without the owner's express final go-ahead.

## Local integrated working copy

Working tree: /home/nur/Projects/archeagent-final-staging
Branch: integration/archeagent-final-local

Sources combined:
- Codex review-admission hardening and local engineering receipts on
  feat/concord-agent-coordination, ending at 9ada4b7
- The latest mother-of-pearl/obsidian immersive UI from
  feat/axuno-exact-local-preview, ending at 621fc8d
- Conflict resolution preserves Codex's fixture-demo truth labels
- Original AXUNO demo exists only as a personal-use local asset excluded
  via .git/info/exclude. Do not commit, distribute or deploy that demo binary.

## Release requirements

1. Finish genuine two independent coding-agent collaboration or label it
   unverified and do not claim it.
2. Finish a real operational Flight Recorder UI, not solely a fixture console,
   or clearly label the limited feature set.
3. Use a font licensed for intended web/commercial deployment; exact AXUNO
   demo cannot be made public merely by changing a glyph.
4. Verify full code/API/browser functionality on the final merged state,
   including trust boundaries, negative cases, mobile, light/dark and motion.
5. Run full test suite with isolated disposable test services.
6. Confirm privacy, secrets and license review, authentic screenshots and
   maintainers' requirements.
7. Verify intended GitHub account identity and explicit repository permissions.
8. Obtain owner's final authorization for **one** consolidated public product
   update. Prefer the existing repository over a proliferation of new repos,
   branches and PRs.
9. Only after the final approval, deliberately unlock the local pre-push
   hold and publish the verified SHA. Record actual GitHub CI, not local-only
   results as if remote CI.

No commits to this local staging tree should be mistaken for public releases.
