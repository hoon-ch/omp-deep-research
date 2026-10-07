# Changelog

## 0.2.2 — 2026-10-07

- Operator-only `/deep-research allow harness|exec` and `deny` replace execution consent on an open mission and record `execution_set` with the prior flags. Grants require data/mixed mode; `allow harness` revokes unrestricted exec and `deny` clears both permissions. Existing evidence, runs, phase and pass budgets remain unchanged; a paused mission still needs explicit `resume`. Revocation does not stop already-running commands.
- Permissionless data/mixed missions, including intake and spec starts, now guide the user to the permission commands before experiments. `ask` answers and model tool calls never grant consent; essential unauthorized experiments produce an honest inconclusive verdict rather than restarting the mission.

## 0.2.1 — 2026-10-07

- **Fix:** file evidence was not checked against what was actually read, so a scout report read at `agent://<id>`, or a receipt for one file, could back a claim about another file. Read-like receipts now record the local paths they covered, and file evidence must cite files those paths cover; `task` summaries and `agent://` reads are rejected for file and experiment evidence.

## 0.2.0 — 2026-10-07

- Distributed as an OMP plugin from GitHub: `omp plugin install github:hoon-ch/omp-deep-research#v0.2.0`, or `omp plugin link <checkout>` for development. The one-off `scripts/publish-github.sh` helper and its tests are removed.
- Cheap parallel exploration: `view:"explore"` returns a lead-finding brief and output schema; the agent fans independent sub-questions out to `scout`s in one `task` call without pinning a model, so the user's scout role (`@smol` by default) does the searching and the main model judges and records evidence. `--max-children` (default 8) caps subagents per pass.
- Subagents spawned during an active mission are governed through a shared in-process registry: `data`-mode web limits, mission pause/cancel and time/token/cost limits apply to their tool calls, and their usage is persisted into the pass (`childTokens`/`childCost`; status shows `tok (scouts N)`). Usage is now recorded for every active mission, not only when a cap is set; blocking-task `details.usage` is no longer added separately (it would double count).
- **Breaking:** `--mode` is no longer defaulted to `web`. Without `--mode`, `/deep-research <objective>` opens an intake: no mission exists and only control tools run until the agent calls `deep_research op:"start"` with the clarified objective, mode, constraints and deliverables. Operator settings stay command-only.
- `--harness` (data/mixed): allows `write` only to a regular, unlinked `<cwd>/autoresearch.sh` and execution of exactly `bash autoresearch.sh` (synchronous, session root), matching Gajae's harness contract without opening general bash.
- `deep_research op:"read", view:"critic"` returns a critic brief adapted from Gajae `auto-critic.md`, with the full evidence/run snapshot and its digest.
- `data` mode blocks URL paths on every tool (OMP `grep`/`read` fetch URLs), not only `read`.
- Spec intake: `/deep-research --spec <file>` (declared `deep-research-mode:` or Gajae `autoresearch-mode:`, H1 objective, constraints, deliverables or acceptance criteria, optional metric); path and SHA-256 recorded.
- Operator mode change `/deep-research mode web|data|mixed` (`mode_set`), keeping evidence and enforcing execution consent.
- Metric contracts: `--metric/--direction`, spec or intake declaration; `op:"segment"` starts a new segment (optional new metric) and baseline/best/keep/discard are per segment. `ASI key=value` lines are parsed and kept on runs. Effect/MAD (Gajae run confidence) once a segment has three valid runs.
- `view:"iterate"` returns a next-experiment planner brief adapted from Gajae `auto-iterate.md`; `view:"runs"` returns per-segment run reports. Critic and iterate briefs carry an `outputSchema` for the scout task item.
- Critic attestation: with `--critic`, the critic record must reference the `task` call that pinned that model and a response receipt that is its result or a `read` of `agent://<id>` for an agent it spawned.
- A conclusive verdict must cite, or address by ID in a caveat, every contradicting evidence item.
- `--max-tokens` / `--max-cost` per-pass budgets from main-session `message_end` usage and blocking task usage.
- Run-table widget above the editor for data/mixed missions, `/deep-research runs`, and status-line run/usage counts.
- Ledger replay is cached per branch tip. An unreadable ledger blocks non-`deep_research` tools until `/deep-research reset-ledger`.
- `report.md` escapes untrusted text (no links, images or HTML from sources).
- Headless: command output goes to stderr without a UI; missions run under `omp --mode rpc --no-ui`; `omp -p` (which drops a command's queued turn in OMP 18.6.1) refuses to start or resume work instead of silently doing nothing.
- Status line shows run and usage counts; `docs/COMPATIBILITY.md` maps Gajae runtime behavior (not only its skill text) to this implementation, with remaining non-goals stated.

## 0.1.0 — 2026-10-06

Initial implementation: OMP-native `/deep-research` command and `deep_research` tool; web/data/mixed mission modes; append-only, branch-aware session events; observed source receipts; deduplicated evidence; metric-based experiment classifications and flags; optional critic receipts; idempotent verdict persistence; bounded advisory continuation; explicit pause/resume/cancel/clear; local Markdown/JSON/JSONL export; conservative parent-tool policy; Korean setup documentation; offline unit and adapter-contract tests; GitHub CI configuration and a guarded publishing helper.

Tool policy uses OMP 18.6.x built-in names (`todo`, `think`, `ast_grep`, `recall`, read-only `github` ops; `bash`/`eval` for `--allow-exec`). Web evidence requires a `read` receipt. Object hashing sorts keys by code point. CI uses `npm ci` with a committed lockfile.

Validated with offline unit and adapter-contract tests and two small live web missions in OMP 18.6.1 (TUI). Headless `omp -p` is not supported. The GitHub publishing helper has not been executed against a remote account.
