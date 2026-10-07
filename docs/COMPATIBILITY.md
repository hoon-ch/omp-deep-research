# Compatibility and upstream mapping

Reviewed on **2026-10-07**. Blob IDs identify the exact file contents read; they are not a tested full upstream checkout.

| Upstream file | Observed Git blob SHA |
|---|---|
| OMP `packages/coding-agent/package.json` (declares `18.6.2`) | `cc9873535f2d007d4eaf5066b8655bea5595d01e` |
| OMP `packages/coding-agent/src/extensibility/extensions/types.ts` | `3dec4e6ac286199555e202829e20a6f54ac97f90` |
| OMP `packages/coding-agent/src/extensibility/shared-events.ts` | `6317bc3bba50655f24a42e3f07adf4df36269373` |
| OMP `packages/coding-agent/src/prompts/tools/task.md` | `c5e45bdf28e89b055d77bc1dc5cffe075e453566` |
| Gajae `packages/coding-agent/src/defaults/gjc/skills/autoresearch/SKILL.md` | `d036174007c4bc736ab3ced9a8710fd7ad59a7a4` |
| Gajae `packages/coding-agent/src/defaults/gjc/skills/autoresearch/auto-critic.md` | `da6c3f6d1a36d2ba390cfd30bcb69df38315edfe` |
| Gajae `packages/coding-agent/src/defaults/gjc/skills/autoresearch/auto-iterate.md` | `d2e2078ab0d9a23564dce9fd1231ee82d890f196` |
| Gajae `packages/coding-agent/src/autoresearch/runs.ts` | `399e52845208314917db663538a03a77a6394896` |
| Gajae `packages/coding-agent/src/autoresearch/harness.ts` | `4b97cc6ed5e1db0fb270060e8697370bad777f51` |
| Gajae `packages/coding-agent/src/gjc-runtime/autoresearch-runtime.ts` | `0f093ff818b00a0be033e62854bc93cb1d9708ab` |
| Gajae `packages/coding-agent/src/skill-state/workflow-mutation-guard.ts` | `841bd26091856f0bcb810ef2c619d0d106638c5a` |
| Gajae `packages/coding-agent/src/autoresearch/git.ts` | `f26483e102f95849dac94e1a152406ef5041b3ed` |
| Gajae `LICENSE` | `16eb3fc020a9dbefb165d2fb1d4597d2203c44bd` |

Gajae files come from commit `1a76298142decaf48b811d480273c703bce2f637` (2026-09-18). OMP facts were checked against tag `v18.6.1`: tool names (`src/tools/builtin-names.ts`, `src/tools/gh.ts` `GITHUB_READONLY_OPS`), bash exit handling (`src/tools/bash.ts`), `setWidget` and print-mode command dispatch (`extension-ui-controller.ts`, `print-mode.ts`, `runner.ts`), `Usage` (`packages/catalog/src/types.ts`) and async task delivery (`task/index.ts`, `async-job-delivery.ts`).

## Primary references

- [OMP extension API](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md)
- [OMP discovery/loading](https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md)
- [OMP public extension types](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts)
- [OMP shared event types](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts)
- [OMP task instructions](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/prompts/tools/task.md)
- [Gajae research workflow](https://github.com/Yeachan-Heo/gajae-code/blob/main/packages/coding-agent/src/defaults/gjc/skills/autoresearch/SKILL.md)

The host contract uses `pi.zod`, `registerTool`, `registerCommand`, `appendEntry`, `sendUserMessage(...,{attribution:'agent'})`, `before_agent_start`, `tool_call`, `tool_result`, `message_end`, `agent_end`, `session_stop`, `ctx.ui.setWidget`, `ctx.mode`, and active-branch reads (`SessionEntry.id`). `session_stop` is notification/continuation integration, not an internal Goal controller. This implementation needs the modern event and schema surfaces above; it does not advertise backward compatibility with every earlier OMP release.

## Gajae → this implementation

"Gajae" below means what Gajae's runtime code does, not only what its skill text says. Several Gajae behaviors are instruction-only or libraries that nothing calls; the table states where this implementation enforces in code.

| Gajae concept | Gajae runtime | Implementation here |
|---|---|---|
| Explicit mode | `write` requires `--mode`; spec intake fails without `autoresearch-mode:`; never inferred | `--mode` or `--spec` starts immediately; otherwise an intake opens and `deep_research op:"start"` requires a mode. Never defaulted or inferred |
| Cold intake | Bare/goal invocation returns `clarification_required` and writes nothing; blocking research tools is instruction-only | Intake event, no mission; every non-control tool is blocked until `op:"start"`. Budgets, execution consent, critic and an operator-declared metric stay operator-only. Refused without a UI (print/json) because `ask` cannot run |
| Spec intake | `--spec`: `autoresearch-mode:` (required), H1 objective, `## Deliverables` or acceptance-criteria items, `## Constraints`, optional metric lines | `--spec <file>`: same rules; accepts `deep-research-*` and Gajae `autoresearch-*` keys; records the spec path and SHA-256. `--mode`/`--metric` flags may not contradict the spec |
| Mode change (`mode_set`) | `write` with a different mode records `mode_set` | `/deep-research mode web\|data\|mixed` (operator-only) records `mode_set`; evidence is kept; execution consent still requires data/mixed |
| Harness | Agent may write only root `autoresearch.sh`; bash is scanned and recognized mutations blocked | `--harness` (data/mixed, user opt-in): `write` only to a regular, unlinked root `autoresearch.sh`; bash only exactly `bash autoresearch.sh`, synchronous, session root. A fixed command instead of a bash mutation scanner |
| Mid-mission execution consent | No corresponding feature asserted | Operator-only `allow harness\|exec` and `deny` record `execution_set`; replace permission on an open mission without resetting budgets or losing evidence. Grants require data/mixed; paused missions still require `resume`; revocation does not kill running commands |
| Run outcome | Agent passes `--status keep\|discard\|crash\|checks_failed`; exit code is derived from that status | Computed from observed tool output: `METRIC` lines and the host's error flag (OMP marks non-zero bash exit as an error result → `crash`) |
| `METRIC` / `ASI` | Parser library exists but is not wired to tool output | Both parsed from every acquisition receipt. Malformed `METRIC` fails the run (`checks_failed`); `ASI` values are typed and kept on the receipt and run, malformed ones skipped |
| Primary metric | Declared at intake (`--primary-metric`, `--metric-direction`) | Declared by `--metric/--direction`, the spec, the intake `start`, or a new segment; otherwise fixed by the segment's first run. Mismatches are rejected |
| Segments | `currentSegment` field exists; nothing advances it | `op:"segment"` starts a new segment (reason, optional new metric). Baseline, best, keep/discard and effect/MAD are per segment; earlier segments stay as history |
| Run confidence | MAD-based confidence library; never written by `log-run` | `effectToNoise` = \|best − baseline\| / MAD over the segment's valid runs (3+), shown in summary, widget and report |
| Flag runs | Store function exists; no CLI verb | `op:"flag_run"`; flagged runs leave baseline/best/noise math |
| Critic prompt | `auto-critic.md` fragment; no runtime invocation code | `view:"critic"` returns adapted instructions + full snapshot + digest |
| Critic identity | Only non-empty `evaluator` checked | Evaluator must differ from the research model and match `--critic`. With a configured critic, `spawnReceiptId` must be the `task` call whose host-observed single-model pin (or host-reported `resolvedModel`) equals the evaluator, and the response receipt must be that task result or a `read` of `agent://<id>` for an agent it spawned |
| Critic gating | Latest critic receipt attached to the verdict; no gating | A configured critic must `pass` the current evidence/run/segment digest before `conclusive` |
| auto-iterate planner | Fragment prompt; no runtime code | `view:"iterate"` returns adapted planner instructions + current-segment snapshot (baseline, best, recent and flagged runs, ASI, harness contract) for the agent or a scout |
| Verdict | Free-form `status` object, string `evidence[]`/`caveats[]`, `evaluator`; not idempotent | `disposition` + `confidence` + findings citing evidence IDs + caveats; `requestId` idempotent. A conclusive verdict must cite or address (by ID) every contradicting evidence item |
| Evidence | Free strings in the verdict | Records bound to observed tool receipts; web evidence needs a `read` of that URL; file evidence needs a local read/search receipt covering every cited file (scout reports at `agent://` never count) |
| Mode-based tool gating | Data-context loader gated by mode, not wired; no tool gating | `data` mode blocks `web_search`, `github` and any tool call whose `path` contains a URL |
| Continuation | Agent drives a GJC goal by instruction; no autoresearch nudge budget | Bounded `session_stop` continuation per pass (`--budget`), plus tool, wall-clock and optional token/cost checkpoints |
| Conclusive auto-clear | Instruction to run `clear` after the goal completes | Completed mission stays visible until explicit `clear` or a new start |
| Inconclusive | Mission stays open | Pass pauses; explicit `resume` starts a new bounded pass |
| Dashboard | HUD chips (`exp=kept/total`, crash, checks_failed, verdict); run-table renderer not mounted | Status line (phase, mode, evidence, runs, tools, continuations, usage) plus a run-table widget above the editor for data/mixed missions; `/deep-research runs` prints the full table |
| Persistent Python | Session `python` tool | OMP `eval` (Python/JS kernels) when `--allow-exec`; not part of `--harness` |
| Git branch keep/discard | Library present, not wired; skill says no Git | No Git operations |
| Handoff to ralplan/deep-interview/ultragoal | Skill handoff verbs | Not applicable: OMP has no such skills. `/deep-research cancel` or `clear` end a mission |

## Deliberate non-goals

These are design decisions, not missing Gajae features:

- **Cross-session merging.** The active session branch is the source of truth so branches and forks never leak evidence. Use `export` to carry results out.
- **Automatic multi-lane scheduling.** The agent fans independent sub-questions out to cheap `scout`s itself (`view:"explore"`, one `task` call, bounded by `--max-children`); the extension budgets and governs those children but does not schedule them.
- **Calibrated evidence scoring.** Verdict confidence stays a qualitative label; the only numeric score is the run effect/MAD ratio, labelled as not a significance test.
- **Cryptographic reviewer identity.** Critic attestation is host-observed (task model pin + linked response), not a signature; a provider can still serve a different model than requested.

## Remaining host limits

- Token/cost budgets count main-session assistant usage and, through a module-level registry, the usage of subagents spawned while the mission was active (OMP 18.6.1 runs subagents in-process and re-binds the extension per child session). A host that ran subagents out of process would lose that child metering and governance.
- OMP 18.6.1 `omp -p` exits without running the turn a command queues (and does not flush the session), so starting or resuming work there is refused; `omp --mode rpc --no-ui` runs missions headless.
- Budgets are checkpoints (next tool call, next stop), not kill switches for a running command.
- `--harness` narrows what the agent may write and run, but the harness itself is agent-written code with the user's privileges. It is a consent boundary, not a sandbox. Gajae has the same property.

Live verification status is in [VERIFICATION.md](VERIFICATION.md).
