# Verification record

**Date:** 2026-10-06 · **Package:** `omp-deep-research@0.1.0`

This is a record of local verification, not a production-readiness claim.
No GitHub repository, push, or GitHub Actions run is recorded here.

## Executed locally

| Check | Result |
|---|---|
| `npm run check` | Passed with TypeScript 5.8.3, strict/noUncheckedIndexedAccess |
| `npm test` | **79 tests passed; 0 failed, 0 skipped** |
| OMP 18.6.1 interactive load (`omp -e <repo>`) | Extension loaded; `/deep-research status` rendered `{"mission": null}` |
| OMP 18.6.1 live web missions (2 runs, small budgets) | `read` URL → receipt → evidence → conclusive verdict → `completed`; ledger held `mission_created`, `tool_counted`, `receipt_recorded`, `evidence_added`, `verdict_issued`; `todo` allowed and not counted (`1/4 tools`) |
| OMP 18.6.1 live `--mode data --harness` mission | Agent wrote `./autoresearch.sh` (wraps an existing `bench.js`, emits `METRIC`), ran `bash autoresearch.sh`; no policy blocks; run `R1` = `baseline` from observed metrics; file + experiment evidence; conclusive verdict |
| OMP 18.6.1 live intake (`/deep-research <objective>` without `--mode`) | Status showed intake; agent asked mode/scope/deliverable via `ask`; `op:"start"` created the mission (`intake_started` → `mission_created`). First run stopped after `start` because the intake prompt said "do not research yet"; the `session_stop` continuation then fired (`1/1 nudges`) and forced an inconclusive verdict. Prompt fixed; rerun researched in the same turn and completed (`5/5 tools`) |
| Live finding: `grep` with URL paths | OMP `grep` fetches `;`-separated URL paths. Evidence from it was correctly rejected (not a `read`), and `data` mode now blocks URL paths on every tool, not only `read` |
| `bash -n scripts/publish-github.sh` | Passed |
| `npm pack --dry-run` | Passed; 18 files, packaging only |

Environment: macOS arm64, Node.js **24.17.0**, TypeScript **5.8.3**, Node type definitions **25.1.0**, OMP **18.6.1** (Homebrew).
Node's experimental TypeScript stripping executes the tests. Its experimental warning is expected.
Tool names in `src/policy.ts` were checked against OMP `v18.6.1` `packages/coding-agent/src/tools/builtin-names.ts` and `gh.ts` `GITHUB_READONLY_OPS`.

## What the tests cover

- Mission and intake lifecycle (intake blocks research tools, `start` keeps operator settings, cancel retires it), explicit mode checks, bounded passes, pause/resume/cancel/clear, branch-local replay and schema-version rejection.
- `--harness`: only a regular, unlinked root `autoresearch.sh` is writable (symlink, hard link, sibling, parent, `~`, internal-URL paths rejected); only an exact, synchronous `bash autoresearch.sh` in the session root runs (chained commands, `cd …&&`, `async`, services, other `cwd` rejected).
- Critic brief: complete evidence IDs, snapshot and current digest.
- Request-ID idempotence, including a repeated verdict after the mission becomes terminal.
- Recorded source receipts, observed URL linkage for `read` paths and output URLs, deduplication and preservation of contradictory evidence.
- Rejection of search snippets as original web evidence, failed reads and fabricated source locators.
- Actual output parsing for `METRIC`, numeric validation, baseline/keep/discard/crash/checks_failed, invalid-run exclusion and metric consistency.
- Evidence-linked findings, mandatory caveats for inconclusive results, configured critic requirements and snapshot invalidation.
- Extension registration and hook behavior using a **mock host**: advisory continuation, duplicate stops, budgets, abort/error handling, automatic-retry handoff and queued-user precedence.
- No load-time side effects, no existing `/autoresearch` replacement, and no dynamic source material interpolated into the system prompt.
- Explicit-only report creation, traversal/symlink rejection, no report overwrite, valid Markdown/JSON/JSONL output.
- Publishing script syntax, private default, explicit public selection and rejection of unsupported flags.

## Not executed or guaranteed

1. **Real OMP/Bun integration (partial):** loading, the TUI command path, intake via `ask`, live tool receipts, harness write/run, session persistence, one `session_stop` continuation and the completed state were observed. Not observed: pause/resume/cancel, branch switching, compaction, critic delegation and export in a live host. Headless `omp -p` does not surface command output (`ctx.hasUI` is false) and is not supported.
2. **Live evaluation:** one harness benchmark ran; no `--allow-exec` run, multi-run keep/discard iteration or independent critic execution was observed. Model/provider aliases and tool availability depend on the installed host.
3. **Remote changes:** repository creation, push, npm publication and GitHub Actions execution did not occur. The supplied publish helper performs remote writes only when the user runs it in an authenticated local environment.
4. **Security and cost isolation:** read-only policy and budgets are not an OS sandbox, an absolute wall-clock kill switch, a child-agent global budget, or a token/currency spending limit.
5. **Evidence truth:** receipts record observed tool results; they do not automatically establish source authenticity, entailment, statistical significance or independent reviewer identity.

## Installed-host smoke checklist

Run in a disposable working directory before enabling this extension globally.

- Load the complete package with `omp -e /absolute/path/to/omp-deep-research`. Confirm no extension load errors and `/deep-research help` works.
- Start a web mission with a small `--budget` and `--max-tools`. Open a primary source, inspect `deep_research` receipts, and save evidence linked to that exact URL.
- Try a source locator absent from the referenced receipt; expect rejection. Try a conclusive verdict without evidence; expect rejection.
- Pause and resume; verify the old evidence remains and a new pass budget appears. Cancel/interrupt; confirm no unsolicited restart.
- Switch or branch a session and return; verify the displayed mission follows only the active branch. Compact and read the durable mission again.
- Observe one `session_stop` continuation and the final bounded stop. Host-level continuation suppression may stop earlier than the plugin budget.
- With an actually available distinct critic model and native read-only `scout`, review the complete evidence/run snapshot. Confirm unknown model selectors fail without fallback.
- For data/mixed experiments, first use existing result files without execution. Enable `--allow-exec` only explicitly in a disposable workspace; confirm the host's normal approval checks still apply.
- Export twice. Confirm two new report directories and valid Markdown/JSON/JSONL. Inspect sensitive content before sharing.
- Run the real GitHub workflow after authorized publication; do not treat the included CI definition as a completed CI run.

Detailed API provenance and known differences from Gajae are in [COMPATIBILITY.md](COMPATIBILITY.md).
