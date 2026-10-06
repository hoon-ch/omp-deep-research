# Changelog

## 0.1.0 — 2026-10-06

Initial implementation: OMP-native `/deep-research` command and `deep_research` tool; web/data/mixed mission modes; append-only, branch-aware session events; observed source receipts; deduplicated evidence; metric-based experiment classifications and flags; optional critic receipts; idempotent verdict persistence; bounded advisory continuation; explicit pause/resume/cancel/clear; local Markdown/JSON/JSONL export; conservative parent-tool policy; Korean setup documentation; offline unit and adapter-contract tests; GitHub CI configuration and a guarded publishing helper.

Tool policy uses OMP 18.6.x built-in names (`todo`, `think`, `ast_grep`, `recall`, read-only `github` ops; `bash`/`eval` for `--allow-exec`). Web evidence requires a `read` receipt. Object hashing sorts keys by code point. CI uses `npm ci` with a committed lockfile.

Validated with offline unit and adapter-contract tests and two small live web missions in OMP 18.6.1 (TUI). Headless `omp -p` is not supported. The GitHub publishing helper has not been executed against a remote account.
