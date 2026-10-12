/** Public synthetic controls only. No MCP, database, model, or release operation. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessConcordReview } from "../src/core/integrations/concord-review";
import { POST } from "../src/app/api/integrations/concord/review-gate/route";

async function main() {
  const fixture = JSON.parse(readFileSync("docs/concord/claimed-review.fixture.json", "utf8"));
  const controls = [
    ["invented-consistent-input", fixture, "READY_FOR_INDEPENDENT_REVIEW"],
    ["forged-authority-fields", { ...fixture, sourceAuthenticated: true,
      evidenceSource: "authenticated_concord", digestMeaning: "source_signature",
      releaseAuthorized: true }, "READY_FOR_INDEPENDENT_REVIEW"],
    ["mismatched-identity", { ...fixture, reviewPacket:
      fixture.reviewPacket.replace("PUBLIC-FIXTURE-42", "IMPOSTER") }, "BLOCKED"],
    ["path-alias-collision", { ...fixture, workState: { ...fixture.workState,
      tasks: [...fixture.workState.tasks, { ...fixture.workState.tasks[0],
        task_id: "OTHER", status: "active", expected_files: ["src/sub/../lib/example.ts"] }] } }, "BLOCKED"],
    ["duplicate-section", { ...fixture, reviewPacket:
      fixture.reviewPacket + "\n## Files touched\n- /outside/secret.ts" }, "BLOCKED"],
    ["failed-test", { ...fixture, reviewPacket:
      fixture.reviewPacket.replace("fixture-test --claimed-pass", "fixture-test (exit 1)") }, "BLOCKED"],
    ["failed-guardrail", { ...fixture, reviewPacket:
      fixture.reviewPacket.replace("Fixture contains no credentials", "Security guardrail failed") }, "BLOCKED"],
    ["contradictory-provenance", { ...fixture, reviewPacket:
      fixture.reviewPacket + "\nNo provenance was recorded." }, "BLOCKED"],
    ["code-example-only", { ...fixture, reviewPacket:
      fixture.reviewPacket.split("\n").map((line: string, index: number) => index ? "    " + line : line).join("\n") }, "BLOCKED"],
    ["malformed-history", { ...fixture, eventsJsonl: "{invalid" }, "BLOCKED"],
  ] as const;
  for (const [name, input, decision] of controls) {
    const result = assessConcordReview(input);
    assert.equal(result.decision, decision, name);
    assert.equal(result.sourceAuthenticated, false, name);
    assert.equal(result.evidenceSource, "caller_supplied", name);
    assert.equal(result.digestMeaning, "content_integrity_only", name);
    assert.equal(result.releaseAuthorized, false, name);
    console.log(`${name}: ${result.decision}; authenticated=false; release=false`);
  }
  assert.throws(() => assessConcordReview({ ...fixture, workState: { ...fixture.workState,
    tasks: [{ ...fixture.workState.tasks[0], expected_files: ["../secret.ts"] }] } }));
  console.log("escaping-path: schema rejection");
  const oversized = JSON.stringify({ ...fixture, padding: "x".repeat(300000) });
  const lengthHeaders: Record<string, string>[] = [{}, { "content-length": "1" }];
  for (const headers of lengthHeaders) {
    const response = await POST(new Request("http://local.invalid/gate", {
      method: "POST", body: oversized, headers,
    }));
    assert.equal(response.status, 413);
    console.log(`oversize direct Request, length=${headers["content-length"] ?? "absent"}: 413`);
  }
  const invalid = await POST(new Request("http://local.invalid/gate", {
    method: "POST", body: JSON.stringify({ ...fixture,
      workState: { generated_at: "invalid", tasks: Array(10000).fill(null) } }),
  }));
  assert.equal(invalid.status, 400);
  assert.ok(Buffer.byteLength(await invalid.text()) < 128);
  console.log("malformed-array: 400; fixed response under128 bytes");
  console.log("PASS: 14 synthetic controls. None authenticates evidence or invokes Concord.");
}

main().catch(() => {
  console.error("FAIL: a public walkthrough assertion did not hold.");
  process.exitCode = 1;
});
