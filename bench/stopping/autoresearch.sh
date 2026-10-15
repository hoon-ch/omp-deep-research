#!/usr/bin/env bash
# Standalone stopping benchmark; does not replace the repository's root autoresearch.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run --silent check
npm test
label="${BENCH_LABEL:-stopping-$(git rev-parse --short HEAD)-$(date +%s)}"
node --no-warnings --experimental-strip-types bench/stopping/run.ts --label "$label" --reps "${BENCH_REPS:-2}" --concurrency "${BENCH_CONCURRENCY:-6}"
