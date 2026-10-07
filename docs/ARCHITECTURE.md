# Architecture

## Modules

`index.ts` is the public-API adapter. It registers one command and one tool, captures parent source receipts, meters main-session usage, installs a research-only parent-tool policy, renders the status line and run widget, and requests bounded advisory continuation using `session_stop`. It does not start timers, invoke providers directly, call internal Goal APIs, change models, or alter Git.

`src/engine.ts` prepares and replays versioned events. `prepareOperation` validates an operation and returns a new event plus its result; the adapter appends the event before returning success. `src/types.ts` defines the persisted data structures. The active OMP branch is the source of truth; the adapter caches one replay per branch tip (keyed by the last research entry), so there is no shared mutable mission state across branches or child sessions.

`src/command.ts` parses explicit operator lifecycle, budget, metric and spec choices. It tokenizes without shell evaluation. `--mode` produces a mission config, `--spec` a config from `src/spec.ts`, and neither produces an intake with operator settings only. Execution consent comes from initial `--harness`/`--allow-exec` flags or operator-only `allow harness|exec`/`deny` commands, never a model tool call or an `ask` response. A critic selector is resolved through the host before the mission or intake is recorded.

`src/runs.ts` holds segment-scoped run math (baseline, best, effect/MAD, run table). `src/receipts.ts` turns a tool result into a receipt (hashes, preview, `METRIC`/`ASI`, source references, task model pins and spawned agent ids) and extracts blocking task usage. `src/briefs.ts` holds the critic and iterate briefs and their output schemas. `src/policy.ts` governs known parent tool calls, including the intake allowlist and the `--harness` file/command check. `src/report.ts` performs explicit, append-only local exports with untrusted text escaped. `src/schema.ts` declares the model-visible schema using the host-provided builder. `src/host.ts` is a small structural contract, not a vendored host SDK.

## State transitions

```text
(nothing) --operator start with --mode or --spec--> active
(nothing) --operator start without either--> intake (no mission; non-control tools blocked)
intake --agent deep_research op:"start" with clarified objective/mode--> active
intake --operator cancel/clear--> (nothing)
active/paused --operator mode <m>--> same phase, new mode (mode_set)
active/paused --operator allow harness|exec / deny--> same phase, new consent (execution_set)
active --operator pause / abort / error / budget--> paused
active --inconclusive verdict--> paused
paused --operator resume (new pass budget)--> active
active --conclusive verdict--> completed
active/paused --operator cancel--> cancelled
any current mission --operator clear--> (no current mission)
completed/cancelled --operator start--> new active mission
unreadable ledger --operator reset-ledger--> (nothing); earlier events stay in history, unreplayed
```

The append-only session history survives `clear` and `reset-ledger`; current state is retired logically. Old inconclusive verdicts remain visible after resuming. Conclusive verdicts cannot be silently overwritten by a new model request. Idempotent replay of the exact already-saved verdict remains valid after completion.

`execution_set` records the permission profile and prior flags. `allow harness` sets only `allowHarness`; `allow exec` sets only `allowExec`; `deny` clears both. Grants require data/mixed mode. Replay validates the profile, mode and open phase before applying it. Nothing else changes: evidence, runs, pass id, usage, deadline and remaining budgets survive. The next active-research tool call uses the replayed permission; already-running commands are not stopped. A paused mission stays paused until explicit `resume`. Permissionless data/mixed starts (including intake/spec) instruct the agent to explain the user commands before experiments and save an inconclusive verdict if essential execution remains unauthorized.

## Evidence flow

```text
parent tool_call → policy check → budget check (tools, time, tokens, cost) → tool_counted
actual tool result → output hash + source refs + METRIC/ASI + task pins + bounded preview → receipt_recorded
opened source receipt → mode + URL/receipt validation → evidence_added
current evidence IDs → referenced findings (contradictions confronted) → verdict_issued
```

Web search snippets, `github` results, `task` summaries and scout reports are rejected as original-source receipts. A web locator must be observed in a `read` receipt for that URL (the requested `path` or a URL in its output). A file locator (`a.ts:10-20; b/c.md:4`) must be covered by the receipt's recorded local paths: receipts from `read`/`grep`/`find`/`glob`/`ast_grep` store the absolute paths the call covered (a search without a path covers the session root; `agent://`, other internal URIs and URLs cover nothing), and each cited file must equal one of them or sit under a covered directory. Experiment evidence needs a `bash`/`eval` run or a local result-file read. This is useful provenance, not a truth oracle. A deceptive source or a misinterpreted source can still produce an incorrect claim.

The receipt preview is at most 2,400 characters; the SHA-256 digest covers the full text delivered by the host (which may itself already be truncated). Input arguments are hashed, not copied wholesale. Source paths and observed URLs are retained. Recent receipts are paginated to avoid repeatedly injecting the full ledger into context.

## Runs and criticism

Metrics are parsed from the tool output, not taken from a model-supplied numeric score. Non-finite or duplicate metric lines invalidate the run; `ASI` lines are kept as typed learning data. A host error result (OMP marks non-zero bash exit as an error) is a crash. Runs belong to the current segment: its metric contract is declared (operator, spec, intake or `op:"segment"`) or fixed by its first run; its first valid run is the baseline and later runs compare with its best unflagged valid run. A new segment resets that math and may change the metric. Flagging is append-only and changes future best-run calculations. With three or more valid runs, effect/MAD = |best − baseline| / median absolute deviation.

With `--harness`, the policy allows `write` only when the path resolves to `<session cwd>/autoresearch.sh` and that path is absent or a regular file with one link (no symlink or hard link to product code), and `bash` only when the command is exactly `bash autoresearch.sh` / `sh ./autoresearch.sh`, not async, not a service, in the session root. The harness body is unrestricted agent-written code; this is a consent and reviewability boundary, not isolation.

A critic receipt binds a declared distinct evaluator to all current evidence IDs and an evidence/run/segment digest. `view:"critic"` returns the instructions, the full snapshot, that digest and an output schema so the parent can hand an identical brief to a `scout` pinned to the critic model. With a configured critic, the record must reference the spawning `task` receipt (whose input pinned exactly that model, or whose blocking result reported it) and a response receipt that is that task result or a `read` of `agent://<id>` for an agent it spawned. New evidence or a run/flag/segment change invalidates the review. A configured critic is required for conclusive output. An inconclusive result is always possible with explicit caveats.

A conclusive verdict must cite, or name in a caveat, every evidence item whose stance is `contradicts`.

## Continuation and authority

The public `session_stop` hook returns `continue:true` with bounded model context. It never returns an indefinitely blocking stop decision. The host's advisory cap and the configured per-pass cap both apply. Repeated delivery of the same session/pass/turn stop ID is idempotent.

Pending user messages take precedence. Aborted signals, terminal agent errors and explicit pause/cancel stop auto-continuation. Automatic host retries marked `willContinue` are left to the host. Existing OMP goal state is never inspected or mutated.

Time, tool, subagent, token and cost budgets are checkpoints (next acquisition call, next stop), not process kill switches. Tokens and cost come from main-session `message_end` usage plus the usage of governed subagents (below). See `SECURITY.md`.

## Delegation boundary

Parent policy allows explicit native `scout` task requests only and rejects custom eval-defined tools. Each `task` call costs one acquisition tool call; each of its items costs one unit of `--max-children`. Exploration scouts are not given a `model`, so the host's scout role (`@smol` by default) runs them, while the main session's model judges sources and writes evidence; scout leads are never evidence.

OMP 18.6.1 runs subagents in-process and re-binds this extension per child session, so module state is shared. The main session's instance publishes its mission in a module-level registry keyed by its agent id. A child first seen while that mission is active (resolved through `agent.parentId`, including nested children) is bound to it:

```text
child tool_call → mission still the bound one and active? → data-mode web block → time/token/cost limits incl. pending child usage
child message_end (assistant) → pending usage on the registry entry
next main-session hook → usage_recorded {source:"children"} → pass.tokens/cost and pass.childTokens/childCost
```

Children first seen with no active mission (ordinary delegation before or after research) are not governed. Child sessions never write the parent's ledger; the main instance persists their usage. The plugin does not enforce an OS sandbox; child read-only behavior relies on the host's scout definition.

## Hosts and output

Interactive (`tui`) and `rpc` hosts run the turn a command queues. OMP 18.6.1 print mode (`-p`, `--mode json`) exits without running it and does not flush the session, so commands that start or resume work are refused there before anything is recorded. Without a UI, command output goes to stderr; with a UI, `notify`, the status line and a run widget (data/mixed missions with runs) are used.

## Durability and failure modes

The extension uses only `appendEntry` and `getBranch` for mission persistence. It does not promise stronger durability than the host's session manager. A write error is returned as an error. Unknown schema versions or malformed/foreign-ordered research events make the ledger unreadable: every non-`deep_research` tool call is blocked (the policy state is unknown) until the operator runs `/deep-research reset-ledger`, which appends a marker after which replay restarts.

Exports are explicit and write three new files in a unique subdirectory. Untrusted text in `report.md` is backslash-escaped Markdown, so sources cannot inject links, images or HTML. A filesystem error can leave a partially created export directory; it cannot turn that incomplete write into a successful result. Retrying creates a new directory rather than overwriting an earlier report.
