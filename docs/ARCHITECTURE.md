# Architecture

## Modules

`index.ts` is the public-API adapter. It registers one command and one tool, captures parent source receipts, installs a research-only parent-tool policy, and requests bounded advisory continuation using `session_stop`. It does not start timers, invoke providers directly, call internal Goal APIs, change models, or alter Git.

`src/engine.ts` prepares and replays versioned events. `prepareOperation` validates an operation and returns a new event plus its result; the adapter appends the event before returning success. `src/types.ts` defines the persisted data structures. The active OMP branch is the source of truth, so there is no shared mutable module-level mission cache to leak across rebinding or children.

`src/command.ts` parses explicit operator lifecycle and budget choices. It tokenizes without shell evaluation. With `--mode` it produces a mission config; without it, an intake with operator settings only. Execution permission (`--harness`, `--allow-exec`) cannot be enabled with a model tool call. A critic selector is resolved through the host before the mission or intake is recorded.

`src/policy.ts` governs known parent tool calls, including the intake allowlist and the `--harness` file/command check. `src/critic.ts` holds the critic brief returned by `view:"critic"`. `src/report.ts` performs explicit, append-only local exports. `src/schema.ts` declares the model-visible schema using the host-provided builder. `src/host.ts` is a small structural contract, not a vendored host SDK or a claim that the real SDK was type-checked locally.

## State transitions

```text
(nothing) --operator start with --mode--> active
(nothing) --operator start without --mode--> intake (no mission; non-control tools blocked)
intake --agent deep_research op:"start" with clarified objective/mode--> active
intake --operator cancel/clear--> (nothing)
active --operator pause / abort / error / budget--> paused
active --inconclusive verdict--> paused
paused --operator resume (new pass budget)--> active
active --conclusive verdict--> completed
active/paused --operator cancel--> cancelled
any current mission --operator clear--> (no current mission)
completed/cancelled --operator start--> new active mission
```

The append-only session history survives `clear`; current state is retired logically. Old inconclusive verdicts remain visible after resuming. Conclusive verdicts cannot be silently overwritten by a new model request. Idempotent replay of the exact already-saved verdict remains valid after completion.

## Evidence flow

```text
parent tool_call → policy check → acquisition-budget check → tool_counted
actual tool result → output hash + source references + bounded preview → receipt_recorded
opened source receipt → mode + URL/receipt validation → evidence_added
current evidence IDs → referenced findings → verdict_issued
```

Web search snippets and `github` results are rejected as original-source receipts. A web locator must be observed in a `read` receipt for that URL (the requested `path` or a URL in its output). This is useful provenance, not a truth oracle. A deceptive source or a misinterpreted source can still produce an incorrect claim.

The receipt preview is at most 2,400 characters; the SHA-256 digest covers the full text delivered by the host (which may itself already be truncated). Input arguments are hashed, not copied wholesale. Source paths and observed URLs are retained. Recent receipts are paginated to avoid repeatedly injecting the full ledger into context.

## Runs and criticism

Metrics are parsed from the tool output, not taken from a model-supplied numeric score. Non-finite or duplicate metric lines invalidate the run. A host error result (OMP marks non-zero bash exit as an error) is a crash. First valid result is baseline; further results compare with the best unflagged valid run. Flagging is append-only and changes future best-run calculations.

With `--harness`, the policy allows `write` only when the path resolves to `<session cwd>/autoresearch.sh` and that path is absent or a regular file with one link (no symlink or hard link to product code), and `bash` only when the command is exactly `bash autoresearch.sh` / `sh ./autoresearch.sh`, not async, not a service, in the session root. The harness body is unrestricted agent-written code; this is a consent and reviewability boundary, not isolation.

A critic receipt binds a declared distinct evaluator to all current evidence IDs and an evidence/run digest. `view:"critic"` returns the instructions, the full evidence/run snapshot and that digest so the parent can hand an identical brief to a `scout` pinned to the critic model. New evidence or a run/flag change invalidates the review. A configured critic is required for conclusive output. An inconclusive result is always possible with explicit caveats. Independent identity and benchmark correctness are not proven by these structural checks.

## Continuation and authority

The public `session_stop` hook returns `continue:true` with bounded model context. It never returns an indefinitely blocking stop decision. The host's advisory cap and the configured per-pass cap both apply. Repeated delivery of the same session/pass/turn stop ID is idempotent.

Pending user messages take precedence. Aborted signals, terminal agent errors and explicit pause/cancel stop auto-continuation. Automatic host retries marked `willContinue` are left to the host. Existing OMP goal state is never inspected or mutated.

Time and acquisition budgets are checkpoint-based, not process kill switches or monetary caps. Control-tool chatter and nested agent steps are not fully metered. See `SECURITY.md`.

## Delegation boundary

Parent policy allows explicit native `scout` task requests only and rejects custom eval-defined tools. Child sessions do not own or mutate the parent's ledger. The plugin does not intercept every child operation or enforce an OS sandbox; child read-only behavior relies on the host's scout definition. Researchers must not use delegation to escape a mode or budget restriction.

## Durability and failure modes

The extension uses only `appendEntry` and `getBranch` for mission persistence. It does not promise stronger durability than the host's session manager. A write error is returned as an error. Unknown schema versions or malformed/foreign-ordered research events fail closed instead of silently resetting a mission.

Exports are explicit and write three new files in a unique subdirectory. A filesystem error can leave a partially created export directory; it cannot turn that incomplete write into a successful result. Retrying creates a new directory rather than overwriting an earlier report.
