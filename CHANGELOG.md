# Changelog

## 0.3.0 — 2026-10-08

Fixes the four provenance gaps reported in the v0.2.2 review (`d69de22`) and closes the limitations left after them: line ranges, existence-only evidence, critic attestation for every critic and the material it was handed, and a strict locator grammar.

- **Fix (R1):** a `read` receipt let any URL that appeared in the page back web evidence. Receipts now separate `opened` (the requested path and the host-reported `url`/`finalUrl` after redirects) from `links` (URLs merely present in the output, kept as leads); web evidence must cite an opened URL.
- **Fix (R2):** file receipts stored the requested scope, so `grep(path:"src")` with no matches, a directory read or a `glob` covered every file below it. Receipts now record files whose content was returned: the host-resolved file of a `read` (selector kept) and files with returned `grep`/`ast_grep` matches. Directory coverage is gone; directory reads, `glob`/`find` lists, searches without matches and `agent://` reads cover no file.
- **Fix (R3):** task receipts kept independent model and agent-id lists, so another agent's response in the same batch passed as the pinned critic's. Task receipts now hold one record per agent (`id`, its own item's single-model pin, host-reported `resolvedModel` or fallback flag, structured answer) from `details.progress[]`/`details.results[]`; the agent that produced the recorded response must have run the critic model.
- **Fix (R4):** the critic digest was stamped at recording time, so a past critic answer could be re-recorded as a review of newer evidence. The critic brief's snapshot now carries `evidenceDigest`, the critic echoes it (required in the output schema), and `op:"critic"` takes assessment, summary, concerns, evidence IDs and the digest from the critic's structured answer; it must match the current digest and evidence set.
- **Line ranges are checked.** File receipts record `files` with the line spans the result showed (`read` `displayContent.lineNumbers`, `grep`/`ast_grep` match and context lines from the grouped display) and whether the whole file was shown. File locators cite ranges (`a.ts:10-20,30`, `N+K`, `#L5-L9`) that must lie inside shown spans; a bare file cites the whole file and needs a complete read.
- **Listing evidence.** New evidence source `listing` records that paths exist, from `glob` (`details.files`) or `find` (`details.hits`) receipts, without line ranges. The critic brief and report label it as existence only.
- **Critic handed material is attested.** Each task agent record carries `briefs`: stable hashes of critic snapshots embedded in its own task input (`notes` excluded). The critic must have been handed the current `view:"critic"` snapshot itself, so pairing the current digest with an edited, summarized or stale snapshot body is rejected.
- **Every critic is attested.** `spawnReceiptId` is required for all critic records, configured or not; the answering agent must have run the declared evaluator (reported model, else its single-model pin), so an unconfigured critic needs a pinned model distinct from the research model.
- **Critic instructions must be handed verbatim.** Task agent records carry `instructed` when the complete `view:"critic"` instructions appear in the agent's own assignment (whitespace-insensitive, prose or JSON string). Removed or rewritten rules are rejected; text added around the brief is not detected.
- **Strict locator grammar.** File and listing locators accept only `path[:ranges]` entries with one optional `(note)`, separated by `;` or `, `. Extra text (`a.ts and b.ts`, `server.js lines 2-4`), URLs and internal URIs are rejected, so no cited file escapes checking.
- **Fix:** a `task` call the host rejected (e.g. `Missing context`) still consumed `--max-children`, so a corrected critic retry could be blocked by the budget (observed live). Unspawned items are now released (`children_released`) when the result reports fewer agents than items.
- **Breaking:** `op:"critic"` input is now `{ evaluator, receiptId, spawnReceiptId }`, all required. Receipt fields `sourceRefs`, `models`, `agentIds` and `paths` are replaced by `opened`, `links`, `agents`, `files` and `listed`; receipts recorded by earlier versions cannot back new web/file evidence or critic records (read the source again or rerun the critic).

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
