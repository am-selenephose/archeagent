import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const fixture = JSON.parse(readFileSync(join(root, "docs/concord/claimed-review.fixture.json"), "utf8"));
const created: string[] = [];
function workspace() {
  const folder = mkdtempSync(join(tmpdir(), "archeagent-concord-cli-"));
  created.push(folder);
  mkdirSync(join(folder, ".concord"));
  writeFileSync(join(folder, ".concord", "WORK_STATE.json"), JSON.stringify(fixture.workState));
  writeFileSync(join(folder, ".concord", "REVIEW_PACKET.md"), fixture.reviewPacket);
  writeFileSync(join(folder, ".concord", "events.jsonl"), fixture.eventsJsonl);
  return folder;
}
function run(folder: string) {
  return spawnSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"),
    resolve(root, "scripts/concord-review-gate.ts"), fixture.taskId], {
    cwd: folder, encoding: "utf8", timeout: 10000,
  });
}
afterEach(() => { for (const folder of created.splice(0)) rmSync(folder, {recursive: true, force: true}); });

describe("Concord CLI local evidence boundary", () => {
  it("loads the fixed regular exports without granting release authority", () => {
    const result = run(workspace());
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).releaseAuthorized).toBe(false);
  });
  it("does not follow a review-packet symlink outside its export folder", () => {
    const folder = workspace();
    const external = join(folder, "outside-packet.md");
    writeFileSync(external, fixture.reviewPacket);
    rmSync(join(folder, ".concord", "REVIEW_PACKET.md"));
    symlinkSync(external, join(folder, ".concord", "REVIEW_PACKET.md"));
    const result = run(folder);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
  it("rejects an oversized local state before schema parsing", () => {
    const folder = workspace();
    writeFileSync(join(folder, ".concord", "WORK_STATE.json"), JSON.stringify({
      ...fixture.workState, ignoredPadding: "x".repeat(300000),
    }));
    const result = run(folder);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
  it("does not reveal local paths or validation details when exports are missing", () => {
    const folder = workspace();
    rmSync(join(folder, ".concord", "events.jsonl"));
    const result = run(folder);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain(folder);
    expect(result.stderr).not.toContain("ENOENT");
  });
});
