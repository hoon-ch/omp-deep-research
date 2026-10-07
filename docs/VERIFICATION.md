# Verification record

**Date:** 2026-10-07 · **Package:** `omp-deep-research@0.2.0`

This is a record of local verification, not a production-readiness claim.
No GitHub repository, push, or GitHub Actions run is recorded here.

## Executed locally

| Check | Result |
|---|---|
| `npm run check` | Passed with TypeScript 5.8.3, strict/noUncheckedIndexedAccess |
| `npm test` | **97 tests passed; 0 failed, 0 skipped** |
| OMP 18.6.1 interactive load (`omp -e <repo>`) | Extension loaded; `/deep-research status` rendered `{"mission": null}` |
| OMP 18.6.1 live web missions (2 runs, small budgets) | `read` URL → receipt → evidence → conclusive verdict → `completed`; ledger held `mission_created`, `tool_counted`, `receipt_recorded`, `evidence_added`, `verdict_issued`; `todo` allowed and not counted (`1/4 tools`) |
| OMP 18.6.1 live `--mode data --harness` mission | Agent wrote `./autoresearch.sh` (wraps an existing `bench.js`, emits `METRIC`), ran `bash autoresearch.sh`; no policy blocks; run `R1` = `baseline` from observed metrics; file + experiment evidence; conclusive verdict |
| OMP 18.6.1 live intake (`/deep-research <objective>` without `--mode`) | Status showed intake; agent asked mode/scope/deliverable via `ask`; `op:"start"` created the mission (`intake_started` → `mission_created`). First run stopped after `start` because the intake prompt said "do not research yet"; the `session_stop` continuation then fired (`1/1 nudges`) and forced an inconclusive verdict. Prompt fixed; rerun researched in the same turn and completed (`5/5 tools`) |
| Live finding: `grep` with URL paths | OMP `grep` fetches `;`-separated URL paths. Evidence from it was correctly rejected (not a `read`), and `data` mode now blocks URL paths on every tool, not only `read` |
| OMP 18.6.1 live `--spec plan.md --harness --critic anthropic/claude-sonnet-5-5 --max-tokens 2000000` | Spec (Gajae-style keys) started the mission with declared metric `ms` (lower). Harness runs `R1` baseline → `R2` keep with `ASI` variant data; the task receipt recorded `models: ["anthropic/claude-sonnet-5-5"]` and `agentIds: ["DRCritic"]`; the critic record was accepted with `spawnReceiptId`; conclusive verdict. 18 `usage_recorded` events, status showed `500953/2000000 tok` |
| OMP 18.6.1 live two-segment mission (`--mode mixed --harness --critic … --metric ms --direction lower`) | Agent read the iterate brief, ran segment 0 (n=200000: baseline → keep), called `op:"segment"` for n=20000, ran segment 1 (baseline → keep); critic passed; exported `report.md` showed both segments, ASI columns and the host-observed critic pin |
| OMP 18.6.1 live web mission with critic, after adding `outputSchema` to the brief | Scout task item carried the brief's `outputSchema`; critic answered in the critic shape; attested critic record and conclusive verdict |
| OMP 18.6.1 live lifecycle | `pause` (aborted the turn) → `mode data` → `status` (paused, data) → `resume` (new pass, `0/6 tools`) → `cancel`; ledger held `mode_set`, `pass_paused`, `pass_resumed`, `mission_cancelled`. `runs` and `export` worked on a completed mission; `mode` on it was refused |
| OMP 18.6.1 headless | `omp --mode rpc --no-ui`: `/deep-research --mode web …` as a `prompt` ran to a conclusive verdict and `session_settled`; `status` went to stderr. `omp -p`: `help` printed to stderr; intake and mission start were refused with guidance (the host drops a command's queued turn and never wrote a session file) |
| OMP 18.6.1 live scout fan-out (`--mode web --max-children 4`, three tools to compare) | Agent read `view:"explore"`, spawned 3 scouts in one `task` call without a model pin; host resolved them through the user's `@smol` role (`modelRole: "smol"`, a cheap flash-class model). Status `3/4 scouts`; `usage_recorded {source:"children"}` events persisted ~1.16M scout tokens out of ~2.0M total; main model re-read leads, recorded 5 evidence items and a conclusive verdict. On two easier questions answerable from one known API the agent chose not to fan out |
| `npm pack --dry-run` | Passed; 21 files, packaging only |

Environment: macOS arm64, Node.js **24.17.0**, TypeScript **5.8.3**, Node type definitions **25.1.0**, OMP **18.6.1** (Homebrew).
Node's experimental TypeScript stripping executes the tests. Its experimental warning is expected.
OMP facts used by the adapter (tool names, `GITHUB_READONLY_OPS`, bash exit handling, `setWidget`, print-mode command dispatch, `Usage`, async task delivery, task `outputSchema`, scout `model: "@smol"`, in-process subagents with shared module state and `agent.parentId`) were checked against OMP tag `v18.6.1` sources.

## What the tests cover

- Mission and intake lifecycle (intake blocks research tools, `start` keeps operator settings, cancel retires it), explicit mode checks, operator `mode_set`, bounded passes, pause/resume/cancel/clear, branch-local replay and schema-version rejection, `reset-ledger` recovery and fail-closed tool blocking on an unreadable ledger.
- `--harness`: only a regular, unlinked root `autoresearch.sh` is writable (symlink, hard link, sibling, parent, `~`, internal-URL paths rejected); only an exact, synchronous `bash autoresearch.sh` in the session root runs (chained commands, `cd …&&`, `async`, services, other `cwd` rejected).
- Spec parsing (mode required, H1 objective, constraints, deliverables/acceptance criteria, metric pair) and flag conflicts; `--metric`, `--max-tokens`, `--max-cost` parsing.
- Segments: metric fixed per segment, new segment may change it, per-segment baseline/best; declared metric enforced from the first run; `ASI` typed parsing; effect/MAD with 3+ valid runs and flagged-run exclusion.
- Critic and iterate briefs; critic attestation (unpinned task, wrong model, unlinked response all rejected); task receipt model/agent-id extraction from async spawn text and blocking `details.results`.
- Request-ID idempotence, including a repeated verdict after the mission becomes terminal.
- Recorded source receipts, observed URL linkage for `read` paths and output URLs, deduplication and preservation of contradictory evidence; conclusive verdicts must confront contradicting evidence.
- Rejection of search snippets as original web evidence, failed reads and fabricated source locators.
- Actual output parsing for `METRIC`, numeric validation, baseline/keep/discard/crash/checks_failed, invalid-run exclusion.
- Token/cost budgets from `message_end` usage; run widget content; stderr output and print-mode refusal without a UI.
- Subagents: each `task` item counts against `--max-children` (oversized batches blocked, explore brief reports `childrenLeft`); a scout bound to an active `data` mission is denied web tools, its usage is persisted only by the main session as `children` usage, it is blocked once the mission pauses, and a scout first seen with no active mission is not governed.
- No load-time side effects, no existing `/autoresearch` replacement, and no dynamic source material interpolated into the system prompt.
- Explicit-only report creation, traversal/symlink rejection, no report overwrite, valid Markdown/JSON/JSONL output, escaped untrusted text.

## Not executed or guaranteed

1. **Real OMP integration (partial):** observed live: loading, TUI commands, intake via `ask`, spec intake, harness write/run, segments, iterate brief, attested critic, token metering, pause/mode/resume/cancel, runs/export, RPC headless, print-mode refusal, one `session_stop` continuation. Not observed live: branch switching, compaction, `reset-ledger` on a real corrupted session, `--max-cost` exhaustion, `--allow-exec`.
2. **Live evaluation:** small benchmarks only; effect/MAD never reached three runs in a live segment.
3. **Remote changes:** repository creation, push, npm publication and GitHub Actions execution did not occur. The supplied publish helper performs remote writes only when the user runs it in an authenticated local environment.
4. **Security and cost isolation:** read-only policy and budgets are not an OS sandbox or a kill switch for running commands; subagent governance and metering rely on OMP running subagents in-process.
5. **Evidence truth:** receipts record observed tool results; they do not automatically establish source authenticity, entailment, statistical significance or independent reviewer identity.

## Installed-host smoke checklist

Run in a disposable working directory before enabling this extension globally.

- Load the complete package with `omp -e /absolute/path/to/omp-deep-research`. Confirm no extension load errors and `/deep-research help` works.
- Start a web mission with a small `--budget` and `--max-tools`. Open a primary source, inspect `deep_research` receipts, and save evidence linked to that exact URL.
- Try a source locator absent from the referenced receipt; expect rejection. Try a conclusive verdict without evidence; expect rejection.
- Pause and resume; verify the old evidence remains and a new pass budget appears. Cancel/interrupt; confirm no unsolicited restart.
- Switch or branch a session and return; verify the displayed mission follows only the active branch. Compact and read the durable mission again.
- Observe one `session_stop` continuation and the final bounded stop. Host-level continuation suppression may stop earlier than the plugin budget.
- With an actually available distinct critic model, run the critic through `view:"critic"` on a `scout` pinned to that model with the brief's `outputSchema`. Confirm the critic record is accepted only with the spawning task receipt, and that unknown model selectors fail without fallback.
- For data/mixed experiments, first use existing result files without execution. Then try `--harness`: a run of `bash autoresearch.sh`, a new `op:"segment"`, and `view:"iterate"`. Enable `--allow-exec` only explicitly in a disposable workspace; confirm the host's normal approval checks still apply.
- Start from a `--spec` file; change the mode of an open mission with `/deep-research mode`; check `/deep-research runs` and the run widget.
- Headless: send `/deep-research --mode web …` as a `prompt` to `omp --mode rpc --no-ui` and wait for `session_settled`.
- Export twice. Confirm two new report directories and valid Markdown/JSON/JSONL. Inspect sensitive content before sharing.
- Run the real GitHub workflow after authorized publication; do not treat the included CI definition as a completed CI run.

Detailed API provenance and known differences from Gajae are in [COMPATIBILITY.md](COMPATIBILITY.md).
