#!/usr/bin/env bash
# Critic-context experiment harness: correctness checks first, then the deterministic critic benchmark.
# Exits non-zero when type-checking or the test suite fails. Real critic judgments: bench/critic/llm.ts.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run -s check >/dev/null
tests=$(npm test 2>&1) || { echo "$tests" | grep -E "^not ok|fail" >&2; exit 1; }
echo "METRIC tests_passed=$(echo "$tests" | sed -n 's/^ℹ pass //p')"
node --experimental-strip-types --no-warnings bench/critic/bench.ts --json "${BENCH_JSON:-/tmp/critic-bench.json}" | grep '^METRIC\|^WRONG\|^MISSING'
