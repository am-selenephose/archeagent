#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORMAL="$ROOT/formal"
CACHE_ROOT="$HOME/.cache/archeagent/tlaplus"
JAR="$CACHE_ROOT/tla2tools-v1.7.4.jar"
URL="https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
EXPECTED_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"

mkdir -p "$CACHE_ROOT"

if [[ ! -f "$JAR" ]]; then
  tmp="$JAR.tmp"
  rm -f "$tmp"
  curl -fL "$URL" -o "$tmp"
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
  if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
    echo "TLA+ artifact SHA-256 mismatch" >&2
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "$JAR"
fi

actual="$(sha256sum "$JAR" | awk '{print $1}')"
if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
  echo "Cached TLA+ artifact SHA-256 mismatch" >&2
  exit 1
fi

SAFE_LOG="$(mktemp)"
NEGATIVE_LOG="$(mktemp)"
trap 'rm -f "$SAFE_LOG" "$NEGATIVE_LOG"' EXIT

cd "$FORMAL"

java -XX:+UseParallelGC -cp "$JAR" tla2sany.SANY ReleaseAuthority.tla >/dev/null

java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC \
  -workers 1 \
  -seed 20260927 \
  -fp 65 \
  -config ReleaseAuthority.cfg \
  ReleaseAuthority.tla \
  >"$SAFE_LOG" 2>&1

if ! grep -q "Model checking completed. No error has been found." "$SAFE_LOG"; then
  cat "$SAFE_LOG" >&2
  echo "Safe release-authority model did not complete cleanly" >&2
  exit 1
fi

set +u
UPDATE_RECEIPTS=$ARCHEAGENT_UPDATE_FORMAL_RECEIPTS
set -u
if [[ -z "$UPDATE_RECEIPTS" ]]; then
  UPDATE_RECEIPTS=0
fi

set +e
java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC \
  -workers 1 \
  -seed 20260927 \
  -fp 65 \
  -config ReleaseAuthorityUnsafe.cfg \
  ReleaseAuthority.tla \
  >"$NEGATIVE_LOG" 2>&1
negative_rc=$?
set -e

if ! grep -q "Invariant ReleaseBindsExactState is violated" "$NEGATIVE_LOG"; then
  cat "$NEGATIVE_LOG" >&2
  echo "Negative control failed to trigger exact-state invariant" >&2
  exit 1
fi

if [[ "$UPDATE_RECEIPTS" == "1" ]]; then
  cp "$SAFE_LOG" "$FORMAL/receipts/release-authority-tlc.txt"
  cp "$NEGATIVE_LOG" "$FORMAL/receipts/release-authority-negative-control.txt"
fi

python3 - "$SAFE_LOG" "$NEGATIVE_LOG" "$negative_rc" "$EXPECTED_SHA256" "$UPDATE_RECEIPTS" <<'PY'
import hashlib
import json
import pathlib
import re
import sys

safe_path = pathlib.Path(sys.argv[1])
negative_path = pathlib.Path(sys.argv[2])
negative_rc = int(sys.argv[3])
tool_sha = sys.argv[4]
update_receipts = sys.argv[5] == "1"

safe = safe_path.read_text(errors="replace")
negative = negative_path.read_text(errors="replace")
root = pathlib.Path.cwd()

def extract(pattern, text):
    match = re.search(pattern, text)
    if not match:
        raise SystemExit("missing expected TLC receipt field: " + pattern)
    return int(match.group(1))

summary = {
    "schema": "archeagent.formal.release_authority.v1",
    "tool": {
        "name": "TLC",
        "tla2tools": "v1.7.4",
        "sha256": tool_sha,
        "seed": 20260927,
        "fingerprint_polynomial": 65,
        "workers": 1,
    },
    "inputs": {
        "spec_sha256": hashlib.sha256((root / "ReleaseAuthority.tla").read_bytes()).hexdigest(),
        "safe_config_sha256": hashlib.sha256((root / "ReleaseAuthority.cfg").read_bytes()).hexdigest(),
        "negative_config_sha256": hashlib.sha256((root / "ReleaseAuthorityUnsafe.cfg").read_bytes()).hexdigest(),
    },
    "safe_model": {
        "passed": "Model checking completed. No error has been found." in safe,
        "states_generated": extract(r"(\d+) states generated", safe),
        "distinct_states": extract(r"states generated, (\d+) distinct states found", safe),
        "states_left": extract(r"distinct states found, (\d+) states left on queue", safe),
        "graph_depth": extract(r"depth of the complete state graph search is (\d+)", safe),
    },
    "negative_control": {
        "expected_violation_observed": "Invariant ReleaseBindsExactState is violated" in negative,
        "violated_invariant": "ReleaseBindsExactState",
        "process_exit_code": negative_rc,
        "counterexample_contains_base_drift": "<DriftBase " in negative,
        "counterexample_contains_unsafe_release": "<UnsafeReleaseIgnoresBase " in negative,
    },
}

if update_receipts:
    (root / "receipts" / "release-authority-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )

print(json.dumps(summary, indent=2))
PY

echo "Formal verification PASS"
echo "Safe model: all configured invariants held"
echo "Negative control: exact-base omission was detected"
