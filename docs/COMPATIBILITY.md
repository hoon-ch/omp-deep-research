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
| Gajae `packages/coding-agent/src/gjc-runtime/autoresearch-runtime.ts` | `0f093ff818b00a0be033e62854bc93cb1d9708ab` |
| Gajae `packages/coding-agent/src/skill-state/workflow-mutation-guard.ts` | `841bd26091856f0bcb810ef2c619d0d106638c5a` |
| Gajae `packages/coding-agent/src/autoresearch/git.ts` | `f26483e102f95849dac94e1a152406ef5041b3ed` |
| Gajae `LICENSE` | `16eb3fc020a9dbefb165d2fb1d4597d2203c44bd` |

Gajae files come from commit `1a76298142decaf48b811d480273c703bce2f637` (2026-09-18). OMP tool names in `src/policy.ts` were checked against tag `v18.6.1` (`src/tools/builtin-names.ts`, `src/tools/gh.ts` `GITHUB_READONLY_OPS`, `src/tools/bash.ts` exit handling).

## Primary references

- [OMP extension API](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md)
- [OMP discovery/loading](https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md)
- [OMP public extension types](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts)
- [OMP shared event types](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts)
- [OMP task instructions](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/prompts/tools/task.md)
- [Gajae research workflow](https://github.com/Yeachan-Heo/gajae-code/blob/main/packages/coding-agent/src/defaults/gjc/skills/autoresearch/SKILL.md)

The host contract uses `pi.zod`, `registerTool`, `registerCommand`, `appendEntry`, `sendUserMessage(...,{attribution:'agent'})`, `before_agent_start`, `tool_call`, `tool_result`, `agent_end`, `session_stop`, and active-branch reads. `session_stop` is notification/continuation integration, not an internal Goal controller. This implementation needs the modern event and schema surfaces above; it does not advertise backward compatibility with every earlier OMP release.

## Gajae → this implementation

"Gajae" below means what Gajae's runtime code does, not only what its skill text says. Several Gajae behaviors are instruction-only; the table states where this implementation enforces in code.

| Gajae concept | Gajae runtime | Implementation here |
|---|---|---|
| Explicit mode | `write` requires `--mode`; spec intake fails without `autoresearch-mode:`; never inferred | `--mode` starts immediately; without it the command opens an intake and `deep_research op:"start"` requires a mode. Never defaulted or inferred |
| Cold intake | Bare/goal invocation returns `clarification_required` and writes nothing; blocking research tools is instruction-only | Intake event, no mission; every non-control tool is blocked until `op:"start"`. Budgets, execution consent and critic stay operator-only |
| Spec intake (deep-interview) | Parses `autoresearch-mode:`, deliverables, constraints from a spec file | Not implemented; OMP has no deep-interview spec. `--mode` with flags is the zero-question path |
| Harness | Agent may write only root `autoresearch.sh`; bash is scanned and recognized mutations blocked | `--harness` (data/mixed, user opt-in): `write` only to a regular, unlinked root `autoresearch.sh`; bash only exactly `bash autoresearch.sh`, synchronous, session root. No general bash scanner |
| Run outcome | Agent passes `--status keep\|discard\|crash\|checks_failed`; exit code is derived from that status | Computed from observed tool output: `METRIC` lines and the host's error flag (OMP marks non-zero bash exit as an error result → `crash`) |
| `METRIC` / `ASI` parsing | Parser library exists but is not wired to tool output | `METRIC` parsed from every acquisition receipt; malformed lines fail the run (`checks_failed`). `ASI` lines are not parsed |
| Flag runs | Store function exists; no CLI verb | `op:"flag_run"`; flagged runs leave best/baseline math |
| Primary metric | Declared at intake (`--primary-metric`, `--metric-direction`) | Fixed by the first logged run; changes are rejected |
| Critic prompt | `auto-critic.md` fragment; no runtime invocation code | `op:"read", view:"critic"` returns adapted instructions + full snapshot + digest for a native `scout` pinned to the critic model |
| Critic identity | Only non-empty `evaluator` checked | Evaluator must differ from the research model and match `--critic` when configured |
| Critic gating | Latest critic receipt attached to the verdict; no gating | A configured critic must `pass` the current evidence/run digest before `conclusive` |
| Verdict | Free-form `status` object, string `evidence[]`/`caveats[]`, `evaluator`; not idempotent | `disposition` + `confidence` + findings citing evidence IDs + caveats; `requestId` idempotent |
| Evidence | Free strings in the verdict | Records bound to observed tool receipts; web evidence needs a `read` of that URL |
| Mode-based tool gating | Data-context loader gated by mode, not wired; no tool gating | `data` mode blocks `web_search`, `github` and any tool call whose `path` contains a URL |
| Continuation | Agent drives a GJC goal by instruction; no autoresearch nudge budget | Bounded `session_stop` continuation per pass (`--budget`), plus tool and wall-clock checkpoints |
| Conclusive auto-clear | Instruction to run `clear` after the goal completes | Completed mission stays visible until explicit `clear` or a new start |
| Inconclusive | Mission stays open | Pass pauses; explicit `resume` starts a new bounded pass |
| Dashboard | HUD chips (`exp=kept/total`, crash, checks_failed, verdict); run-table renderer not mounted | Status line with phase, mode, evidence, runs, tools and continuations |
| auto-iterate planner | Fragment prompt; no runtime code | Not implemented |
| Persistent Python | Session `python` tool | OMP `eval` (Python/JS kernels) when `--allow-exec`; not part of `--harness` |
| Git branch keep/discard | Library present, not wired; skill says no Git | No Git operations |

## Known gaps

This is not a byte-for-byte port, a GJC file-format importer, or a replacement for GJC's runtime. Not implemented: deep-interview spec intake, mid-mission mode change (`mode_set`), intake-time primary-metric declaration, `ASI` lines, segments, the auto-iterate planner, a run-table dashboard, contradiction graphs, multi-lane scheduling, calibrated evidence scoring, cross-session merging, hard token/currency limits, and independently attested reviewer identity.

`--harness` narrows what the agent may write and run, but the harness itself is agent-written code with the user's privileges. It is a consent boundary, not a sandbox. Gajae has the same property.

Live verification status is in [VERIFICATION.md](VERIFICATION.md).
