# Changelog

## Unreleased

- **Breaking:** `--mode` is no longer defaulted to `web`. Without `--mode`, `/deep-research <objective>` opens an intake: no mission exists and only control tools run until the agent calls `deep_research op:"start"` with the clarified objective, mode, constraints and deliverables. Operator settings stay command-only.
- `--harness` (data/mixed): allows `write` only to a regular, unlinked `<cwd>/autoresearch.sh` and execution of exactly `bash autoresearch.sh` (synchronous, session root), matching Gajae's harness contract without opening general bash.
- `deep_research op:"read", view:"critic"` returns a critic brief adapted from Gajae `auto-critic.md`, with the full evidence/run snapshot and its digest.
- `data` mode blocks URL paths on every tool (OMP `grep`/`read` fetch URLs), not only `read`.
- Status line shows the run count; `docs/COMPATIBILITY.md` maps Gajae runtime behavior (not only its skill text) to this implementation.

## 0.1.0 — 2026-10-06

Initial implementation: OMP-native `/deep-research` command and `deep_research` tool; web/data/mixed mission modes; append-only, branch-aware session events; observed source receipts; deduplicated evidence; metric-based experiment classifications and flags; optional critic receipts; idempotent verdict persistence; bounded advisory continuation; explicit pause/resume/cancel/clear; local Markdown/JSON/JSONL export; conservative parent-tool policy; Korean setup documentation; offline unit and adapter-contract tests; GitHub CI configuration and a guarded publishing helper.

Tool policy uses OMP 18.6.x built-in names (`todo`, `think`, `ast_grep`, `recall`, read-only `github` ops; `bash`/`eval` for `--allow-exec`). Web evidence requires a `read` receipt. Object hashing sorts keys by code point. CI uses `npm ci` with a committed lockfile.

Validated with offline unit and adapter-contract tests and two small live web missions in OMP 18.6.1 (TUI). Headless `omp -p` is not supported. The GitHub publishing helper has not been executed against a remote account.
