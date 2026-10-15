#!/usr/bin/env bash
# Scout-allocation benchmark: runs the frozen live suite (bench/cases.ts) against this checkout,
# which OMP loads as the linked omp-deep-research plugin. Prints METRIC lines; exits non-zero on hard-gate failure.
set -euo pipefail
cd "$(dirname "$0")"
exec node --experimental-strip-types --no-warnings bench/suite.ts
