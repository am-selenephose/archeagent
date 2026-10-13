import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureTreeManifest, verifyTreeManifest } from "../src/server/concord/tree-manifest";

const directories: string[] = [];
function tree() {
  const parent = "/home/nur/Projects/archeagent-final-staging/.local-audit";
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, "receipt-tree-")); directories.push(root);
  for (const dir of ["src", "tests", "scripts", "services", "formal", "docs", "public", "public/fonts"]) mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "package.json"), '{"private":true}', { mode: 0o644 });
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", { mode: 0o644 });
  writeFileSync(join(root, "src", "tracked.ts"), "export const number = 1;\n", { mode: 0o644 });
  writeFileSync(join(root, "tests", "check.test.ts"), "test('real', () => {});\n", { mode: 0o644 });
  return root;
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("complete relevant-tree manifests", () => {
  it("includes untracked source, configuration, tests and lockfiles without relying on Git", () => {
    // A git-diff-only manifest would miss the newly created untracked source.
    const root = tree(); writeFileSync(join(root, "src", "untracked.ts"), "new implementation", { mode: 0o644 });
    const manifest = captureTreeManifest(root);
    expect(manifest.version).toBe("archeagent.tree-manifest.v1");
    expect(manifest.files.map(file => file.path)).toEqual(["package.json", "pnpm-lock.yaml", "src/tracked.ts", "src/untracked.ts", "tests/check.test.ts"]);
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyTreeManifest(manifest, root)).toBe(true);
  });
  it("invalidates the tested tree when bytes change even though no commit changes", () => {
    const root = tree(); const manifest = captureTreeManifest(root);
    writeFileSync(join(root, "src", "tracked.ts"), "different source");
    expect(verifyTreeManifest(manifest, root)).toBe(false);
  });
  it("binds executed native persistence sources and invalidates a changed broker", () => {
    const root = tree(); mkdirSync(join(root, "native"), { mode: 0o700 });
    const broker = join(root, "native", "concord-persistence.c");
    writeFileSync(broker, "/* owned synthetic native implementation v1 */\n");
    const manifest = captureTreeManifest(root);
    expect(manifest.files.some(file => file.path === "native/concord-persistence.c")).toBe(true);
    writeFileSync(broker, "/* owned synthetic native implementation v2 */\n");
    expect(verifyTreeManifest(manifest, root)).toBe(false);
  });
  it("invalidates an absent expected file and a newly added source file", () => {
    const root = tree(); const manifest = captureTreeManifest(root);
    rmSync(join(root, "tests", "check.test.ts"));
    expect(verifyTreeManifest(manifest, root)).toBe(false);
    writeFileSync(join(root, "tests", "check.test.ts"), "test('real', () => {});\n", { mode: 0o644 });
    writeFileSync(join(root, "scripts", "new-check.ts"), "new check");
    expect(verifyTreeManifest(manifest, root)).toBe(false);
  });
  it("binds file permissions rather than accepting executable-bit changes", () => {
    const root = tree(); const manifest = captureTreeManifest(root);
    chmodSync(join(root, "src", "tracked.ts"), 0o755);
    expect(verifyTreeManifest(manifest, root)).toBe(false);
  });
  it("excludes credential, dependency, build, Git and private-font bytes", () => {
    const root = tree(); const before = captureTreeManifest(root);
    for (const directory of [".concord", ".git", "node_modules", ".next-local-completion", ".local-audit", "src/node_modules"]) mkdirSync(join(root, directory), { recursive: true, mode: 0o700 });
    for (const filename of [".env.local", ".concord/receipt-key.json", ".git/config", "node_modules/dep.js", ".next-local-completion/app.js", ".local-audit/log.txt", "src/.env", "src/key.pem", "src/node_modules/dep.js", "public/fonts/axuno-original-demo.otf"]) writeFileSync(join(root, filename), "PRIVATE_SENTINEL");
    expect(captureTreeManifest(root)).toEqual(before);
  });
  it.each(["file", "directory", "hardlink"])("rejects an included %s alias rather than following outside bytes", kind => {
    const root = tree(); const target = join(root, "outside-private"); writeFileSync(target, "private");
    if (kind === "file") symlinkSync(target, join(root, "src", "linked.ts"));
    if (kind === "directory") symlinkSync(root, join(root, "src", "linked"));
    if (kind === "hardlink") linkSync(target, join(root, "src", "linked.ts"));
    expect(() => captureTreeManifest(root)).toThrow("Relevant tree unavailable");
  });
  it("rejects a forged manifest digest, duplicate files, path traversal and unknown claims", () => {
    const root = tree(); const manifest = captureTreeManifest(root);
    for (const changed of [
      { ...manifest, digest: "0".repeat(64) },
      { ...manifest, files: [...manifest.files, manifest.files[0]] },
      { ...manifest, files: [{ ...manifest.files[0], path: "../private" }, ...manifest.files.slice(1)] },
      { ...manifest, authenticatesSource: true },
    ]) expect(verifyTreeManifest(changed, root)).toBe(false);
  });
});
