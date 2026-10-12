# Reproducible local walkthrough

Run from the repository root after `pnpm install --frozen-lockfile`.
The checked-in input is **deliberately invented public data**, not a Concord
model-session record. None of these commands invokes a model, writes the
original Concord database, merges Git, or authorizes a release.

## 1. Assert the evidence boundary

```bash
pnpm exec tsx scripts/concord-audit-walkthrough.ts
pnpm exec vitest run tests/concord-review-gate.test.ts tests/concord-review-api.test.ts tests/concord-review-cli.test.ts
```

The walkthrough asserts 14 controls and exits nonzero on failure:

- Consistent invented input can be READY, but is always unauthenticated.
- Caller-forged authentication, signature and release fields have no authority.
- Mismatched identity, aliased active collision, duplicate scope section,
  failed test, failed guardrail, contradictory provenance, code-only evidence
  and malformed history are BLOCKED.
- An escaping path is rejected by the schema.
- Actual oversized synthetic Request bodies return 413 even without an honest
  length header; malformed arrays return a fixed 400 response under 128 bytes.

The synthetic `Content-Length: 1` Request is a direct handler test, **not** a
claim about live HTTP framing. Actual HTTP chunked input is tested separately.
The prose checks detect bounded contradictions; they cannot verify arbitrary
claims, execution, completeness, source identity or signature authenticity.

## 2. Actual HTTP

First build and start only your own loopback server on an unused port:

```bash
pnpm build
NEXT_TELEMETRY_DISABLED=1 pnpm start --hostname 127.0.0.1 --port 34331
```

In another terminal:

```bash
curl --fail-with-body -sS -H 'Content-Type: application/json' \
  --data-binary @docs/concord/claimed-review.fixture.json \
  http://127.0.0.1:34331/api/integrations/concord/review-gate
```

This returns an admission assessment with `sourceAuthenticated: false`,
`evidenceSource: "caller_supplied"`, `digestMeaning: "content_integrity_only"`
and `releaseAuthorized: false`. SHA-256 identifies parsed supplied data; it
does not authenticate Concord or independently execute the packet's tests.

For live chunked and contradictory negative controls:

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
const fixture = JSON.parse(readFileSync('docs/concord/claimed-review.fixture.json', 'utf8'));
const cases = [
  ['contradictory-test', {...fixture, reviewPacket: fixture.reviewPacket.replace(
    'fixture-test --claimed-pass', 'fixture-test (exit 1)')}, 200, 'BLOCKED'],
  ['chunked-oversize', {...fixture, padding: 'x'.repeat(300000)}, 413, undefined],
  ['bounded-error', {...fixture, workState: {generated_at: 'invalid',
    tasks: Array(10000).fill(null)}}, 400, undefined],
];
for (const [name, data, status, decision] of cases) {
  const body = JSON.stringify(data);
  const response = await new Promise((resolve, reject) => {
    const req = request('http://127.0.0.1:34331/api/integrations/concord/review-gate', {
      method: 'POST', headers: {'content-type': 'application/json'},
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({status: res.statusCode, text}));
    });
    req.on('error', reject);
    req.write(body.slice(0, 100000)); // No Content-Length; native HTTP chunked framing.
    req.end(body.slice(100000));
  });
  assert.equal(response.status, status, name);
  const result = JSON.parse(response.text);
  if (decision) {
    assert.equal(result.decision, decision);
    assert.equal(result.sourceAuthenticated, false);
    assert.equal(result.releaseAuthorized, false);
  } else assert.ok(Buffer.byteLength(response.text) < 128);
  console.log(name, response.status, decision ?? 'fixed error');
}
JS
```

## 3. Real browser, fixture UI

Open `http://127.0.0.1:34331/#console`. The fixture disclaimer must remain
visible. Run the fixture lifecycle; inspect 12 example stages and the
HEAD-DRIFT negative control. No live Concord session, model/provider run,
Go container execution, Git merge or deployment is started by that button.
There is **no Concord Flight Recorder UI** in this submission.

In the browser's network developer tools, block `/api/intelligence/demo` and
rerun. An inline error and enabled retry must replace the loading state.
Remove the block and retry; the fixture must complete without a page reload.
Reset network controls afterward. Stop only your terminal's server with Ctrl+C.

[Desktop capture](screenshots/lifecycle-fixture.jpg) ·
[Mobile capture](screenshots/mobile-fixture.jpg) ·
[Recovery capture](screenshots/fixture-fetch-recovery.jpg).
These are actual browser captures of fixtures, not a model/MCP demonstration.
No video is included.

## 4. Optional historical Concord inspection

The original private database and exports are intentionally absent from Git.
On the original authorized machine, while no writer is active and WAL is empty:

```bash
sqlite3 -readonly \
  'file:/home/nur/Projects/archeagent-concord-hiring/.concord/concord.db?mode=ro&immutable=1' \
  'SELECT id,task_id,tool,status,detail,created_at FROM events ORDER BY id;
   SELECT id,from_agent_id,to_agent_id,delivery_status,task_version,resolved_at FROM handoffs;
   SELECT (SELECT count(*) FROM agent_endpoints) AS endpoints,
          (SELECT count(*) FROM agent_messages) AS messages,
          (SELECT count(*) FROM agent_message_events) AS message_events,
          (SELECT count(*) FROM task_updates) AS updates;'
pnpm concord:gate ARC-CONCORD-001
```

Original observations: five events; one unaddressed, recorded handoff; zero
endpoints/messages/message events/task updates. The repaired gate passes 15
consistency checks with authentication and release authorization false.
This does not establish genuine two-model collaboration or test execution.
Use an authorized snapshot instead of immutable mode for a changing database.
Do not rerun the historical writing script against the original database.

## 5. Full verification

Use the isolated-service commands in [RECRUITER_HANDOFF.md](RECRUITER_HANDOFF.md).
The suite truncates its target database tables, so never aim it at production.
Check both production and development dependencies; a production-only green
audit does not mean the complete development toolchain is clear.
