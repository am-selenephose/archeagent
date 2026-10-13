import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LOCAL_ROOT } from "./local-paths";
import { canonicalReceiptJson } from "./receipt-canonical";

// Policy v1 includes all source/config/test bytes (including untracked files),
// not just Git's index or HEAD. Private state, dependencies, generated outputs,
// environment/credential files and all private font assets are excluded.
export const TREE_POLICY = Object.freeze({
  directories: ["src", "tests", "scripts", "services", "native", "formal", "benchmarks", "docs", "public", ".github"] as readonly string[],
  rootFiles: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next-env.d.ts", "next.config.ts", "next.config.mjs", "next.config.js", "eslint.config.mjs", "postcss.config.mjs", "tailwind.config.ts", "vitest.config.ts", "vitest.config.mts", "AGENTS.md", "CLAUDE.md", "README.md", ".gitignore", ".dockerignore", "Dockerfile", ".nvmrc"] as readonly string[],
});
const MAX_FILES = 4096;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TREE_BYTES = 64 * 1024 * 1024;
function excluded(segment: string): boolean {
  return [".git", ".concord", ".local-audit", ".superpowers", "node_modules", "dist", "build", "coverage", "target"].includes(segment) || segment.startsWith(".next") || /^\.env(?:\.|$)/.test(segment) || /\.(?:pem|key|p12|pfx)$/i.test(segment) || ["credentials.json", "receipt-key.json", "recorder-access.json"].includes(segment);
}
function included(path: string): boolean {
  if (!path || path.length > 1024 || /[\x00-\x1f\x7f\\]/.test(path)) return false;
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || excluded(part))) return false;
  if (parts.length === 1) return TREE_POLICY.rootFiles.includes(path);
  return TREE_POLICY.directories.includes(parts[0]) && !(parts[0] === "public" && parts[1] === "fonts");
}
const fileSchema = z.object({ path: z.string().refine(included), mode: z.number().int().min(0).max(0o777), size: z.number().int().nonnegative().max(MAX_FILE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const treeManifestSchema = z.object({ version: z.literal("archeagent.tree-manifest.v1"), files: z.array(fileSchema).min(2).max(MAX_FILES), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine(value => value.files.every((file, index) => index === 0 || value.files[index - 1].path < file.path) && value.files.some(file => file.path === "package.json") && value.files.some(file => file.path === "pnpm-lock.yaml") && value.files.reduce((sum, file) => sum + file.size, 0) <= MAX_TREE_BYTES);
export type TreeFile = z.infer<typeof fileSchema>;
export type TreeManifest = z.infer<typeof treeManifestSchema>;
function digestFiles(files: TreeFile[]): string { return createHash("sha256").update(canonicalReceiptJson({ version: "archeagent.tree-manifest.v1", files })).digest("hex"); }
export function validTreeManifest(input: unknown): TreeManifest | undefined {
  try { const value = treeManifestSchema.parse(input); return value.digest === digestFiles(value.files) ? value : undefined; } catch { return undefined; }
}

/** Read-only reproducibility helper; the collector itself always uses LOCAL_ROOT. */
export function captureTreeManifest(root = LOCAL_ROOT): TreeManifest {
  try {
    if (realpathSync(root) !== root || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error();
    const files: TreeFile[] = []; let total = 0;
    function walk(relative: string, depth: number): void {
      if (depth > 24) throw new Error();
      const filename = join(root, relative); const before = lstatSync(filename);
      if (before.isSymbolicLink()) throw new Error();
      if (before.isDirectory()) {
        if (realpathSync(filename) !== filename) throw new Error();
        const names = readdirSync(filename).sort();
        for (const name of names) {
          if (excluded(name) || (relative === "public" && name === "fonts")) continue;
          walk(relative ? `${relative}/${name}` : name, depth + 1);
        }
        const after = lstatSync(filename);
        if (after.dev !== before.dev || after.ino !== before.ino || JSON.stringify(readdirSync(filename).sort()) !== JSON.stringify(names)) throw new Error();
        return;
      }
      if (!included(relative)) return;
      if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE_BYTES || files.length >= MAX_FILES) throw new Error();
      const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const acquired = fstatSync(fd);
        if (!acquired.isFile() || acquired.nlink !== 1 || acquired.dev !== before.dev || acquired.ino !== before.ino || acquired.size !== before.size) throw new Error();
        const bytes = readFileSync(fd); const after = fstatSync(fd); const leaf = lstatSync(filename);
        if (bytes.length !== acquired.size || after.size !== acquired.size || after.mtimeMs !== acquired.mtimeMs || after.ctimeMs !== acquired.ctimeMs || leaf.dev !== acquired.dev || leaf.ino !== acquired.ino || leaf.nlink !== 1) throw new Error();
        total += bytes.length; if (total > MAX_TREE_BYTES) throw new Error();
        files.push({ path: relative, mode: acquired.mode & 0o777, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      } finally { closeSync(fd); }
    }
    for (const name of TREE_POLICY.rootFiles) { try { lstatSync(join(root, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; } walk(name, 0); }
    for (const name of TREE_POLICY.directories) { try { lstatSync(join(root, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; } walk(name, 0); }
    files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return treeManifestSchema.parse({ version: "archeagent.tree-manifest.v1", files, digest: digestFiles(files) });
  } catch { throw new Error("Relevant tree unavailable"); }
}
export function verifyTreeManifest(input: unknown, root = LOCAL_ROOT): boolean {
  try { const manifest = validTreeManifest(input); return !!manifest && canonicalReceiptJson(manifest) === canonicalReceiptJson(captureTreeManifest(root)); } catch { return false; }
}
