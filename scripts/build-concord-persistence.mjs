import { mkdirSync, realpathSync, lstatSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
const root = "/home/nur/Projects/archeagent-final-staging";
if (process.argv.length !== 2 || realpathSync(root) !== root) throw new Error("Invalid native build scope");
const output = `${root}/.local-audit/native-persistence`;
mkdirSync(output, { recursive: true, mode: 0o700 });
if (realpathSync(output) !== output || lstatSync(output).uid !== process.getuid()) throw new Error("Unsafe native build directory");
const temporary = mkdtempSync(`${output}/build-`);
try {
  for (const [source, target, libs] of [["concord-persistence.c", "broker", ["-lcrypto"]], ["concord-persistence-launcher.c", "launcher", []]]) {
    const result = spawnSync("/usr/bin/cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-fstack-protector-strong", "-D_FORTIFY_SOURCE=3", `${root}/native/${source}`, ...libs, "-o", `${temporary}/${target}`], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
  if (!process.exitCode) { for (const target of ["broker", "launcher"]) renameSync(`${temporary}/${target}`, `${output}/${target}`); }
} finally { rmSync(temporary, { recursive: true, force: true }); }
