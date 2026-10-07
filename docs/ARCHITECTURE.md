# Architecture

## Modules

`index.ts` is the public-API adapter. It registers one command and one tool, captures parent source receipts, meters main-session usage, installs a research-only parent-tool policy, renders the status line and run widget, and requests bounded advisory continuation using `session_stop`. It does not start timers, invoke providers directly, call internal Goal APIs, change models, or alter Git.

`src/engine.ts` prepares and replays versioned events. `prepareOperation` validates an operation and returns a new event plus its result; the adapter appends the event before returning success. `src/types.ts` defines the persisted data structures. The active OMP branch is the source of truth; the adapter caches one replay per branch tip (keyed by the last research entry), so there is no shared mutable mission state across branches or child sessions.

`src/command.ts` parses explicit operator lifecycle, budget, metric and spec choices. It tokenizes without shell evaluation. `--mode` produces a mission config, `--spec` a config from `src/spec.ts`, and neither produces an intake with operator settings only. Execution consent comes from initial `--harness`/`--allow-exec` flags or operator-only `allow harness|exec`/`deny` commands, never a model tool call or an `ask` response. A critic selector is resolved through the host before the mission or intake is recorded.

`src/runs.ts` holds segment-scoped run math (baseline, best, effect/MAD, run table). `src/receipts.ts` turns a tool result into a receipt (hashes, preview, `METRIC`/`ASI`, opened sources vs. output links, files whose content was returned, per-agent task records, structured critic answers) and extracts blocking task usage. `src/briefs.ts` holds the critic and iterate briefs and their output schemas. `src/policy.ts` governs known parent tool calls, including the intake allowlist and the `--harness` file/command check. `src/report.ts` performs explicit, append-only local exports with untrusted text escaped. `src/schema.ts` declares the model-visible schema using the host-provided builder. `src/host.ts` is a small structural contract, not a vendored host SDK.

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
actual tool result + host details → output hash + opened sources / output links + returned files + per-agent task records + critic answer + METRIC/ASI + bounded preview → receipt_recorded
opened source receipt → mode + URL/receipt validation → evidence_added
current evidence IDs → referenced findings (contradictions confronted) → verdict_issued
```

Web search snippets, `github` results, `task` summaries and scout reports are rejected as original-source receipts. A web locator must be one a `read` receipt actually opened: the requested `path` or the host-reported `url`/`finalUrl` (after redirects). URLs that only appear inside the output (links on a page, URLs a scout suggests) are stored separately as `links`: leads, never reads.

File receipts record `files`: each file whose content the result returned, the merged line spans it showed and whether it showed the whole file. A `read` records the host-resolved file (`resolvedPath`, else `meta.source` of type `path`) and the lines from `displayContent.lineNumbers` (elisions break spans); it is complete when it showed lines 1 through `totalLines`, which the host reports only at EOF. Non-text reads (images, PDFs) without line data are complete unless the host reported truncation or a summary, or a selector, query, archive member or table narrowed the read. Parts of a delimited read are recorded without lines, because the host drops per-part details. `grep`/`ast_grep` record only files with returned matches (host `details.files`) and the match and context lines parsed from the host's grouped `displayContent` (`# dir/`, `## name#TAG`, `*12│…`), never the searched scope. A file locator (`a.ts:10-20,30; b/c.md:4+3; d.ts#L5-L9`) cites ranges, each of which must lie inside one shown span; a bare file cites the whole file and needs a complete read. Directory reads, `glob`/`find` lists, searches without matches, `agent://` and other internal URIs (even though the host reports their backing file) and URLs return no file content.

A file or listing locator is strictly a list of entries separated by `;` (or `, ` outside parentheses), each a local path with optional ranges and at most one optional parenthesized note. Anything else in an entry (`a.ts and b.ts`, `server.js lines 2-4`, a URL, an internal URI) is rejected, so every file a locator names is checked.

`glob` (`details.files`) and `find` (`details.hits[].rel`) receipts record `listed` paths. Evidence with source `listing` cites such paths (or files a content receipt returned) without line ranges: it establishes that paths exist, nothing about their content. The extension cannot judge whether a claim stays within that; the source label is shown to the critic, whose brief tells it to reject content claims backed by listings, and in the report. Experiment evidence needs a `bash`/`eval` run or a local result-file read. This is useful provenance, not a truth oracle. A deceptive source or a misinterpreted source can still produce an incorrect claim.

The receipt preview is at most 2,400 characters; the SHA-256 digest covers the full text delivered by the host (which may itself already be truncated). Input arguments are hashed, not copied wholesale. Opened sources, output links, returned files with their shown lines and listed paths are retained. Recent receipts are paginated to avoid repeatedly injecting the full ledger into context.

## Runs and criticism

Metrics are parsed from the tool output, not taken from a model-supplied numeric score. Non-finite or duplicate metric lines invalidate the run; `ASI` lines are kept as typed learning data. A host error result (OMP marks non-zero bash exit as an error) is a crash. Runs belong to the current segment: its metric contract is declared (operator, spec, intake or `op:"segment"`) or fixed by its first run; its first valid run is the baseline and later runs compare with its best unflagged valid run. A new segment resets that math and may change the metric. Flagging is append-only and changes future best-run calculations. With three or more valid runs, effect/MAD = |best − baseline| / median absolute deviation.

With `--harness`, the policy allows `write` only when the path resolves to `<session cwd>/autoresearch.sh` and that path is absent or a regular file with one link (no symlink or hard link to product code), and `bash` only when the command is exactly `bash autoresearch.sh` / `sh ./autoresearch.sh`, not async, not a service, in the session root. The harness body is unrestricted agent-written code; this is a consent and reviewability boundary, not isolation.

A critic record is the critic's own structured answer, not the recording model's paraphrase. `view:"critic"` returns the instructions, an output schema and the full snapshot, which carries its evidence/run/segment `evidenceDigest`; the critic echoes that digest. Receipts parse this answer from the host's structured task output or from the raw content of a `read` of `agent://<id>`. `op:"critic"` takes only the evaluator, the response receipt and the spawn receipt; assessment, summary, concerns, evidence IDs and the digest come from the answer, which must name the current digest and every current evidence ID. A past answer therefore cannot be re-recorded for a newer snapshot.

Every critic record, whether or not `--critic` is configured, must reference the spawning `task` receipt; a self-declared evaluator would otherwise appear in verdicts and reports. That receipt holds one record per spawned agent, taken from task `details.progress[]`/`details.results[]` by item `index`: `id`, the host-resolved single-model pin of its own task item, the host-reported `resolvedModel` or a fallback flag, its structured answer, and what its own item plus the shared `context` handed it. The response must be a `read` of that agent's `agent://<id>` or a blocking result with exactly one structured answer. That agent — not merely some agent of the same batch — must have run the evaluator model (reported model first, else its pin; an unpinned agent or a reported fallback fails), so even an unconfigured critic needs a pinned model distinct from the research model.

The echoed digest alone would not show what the critic actually read: a recording model could pair the current digest with an edited, summarized or stale snapshot body, or rewrite the critic's rules. So the agent record also holds `briefs`, the `snapshotHash` (stable, key-order and whitespace independent; `notes` excluded) of every critic snapshot embedded as JSON in its assignment, and `instructed`, set when the complete `view:"critic"` instructions appear verbatim (whitespace-insensitive) as prose or as a JSON string value. The attested agent must have both the current snapshot hash and `instructed`. Text added around the instructions and snapshot (for example an extra "answer pass") is not detected: requiring the assignment to equal the brief exactly would reject ordinary task items, whose wrappers and fields vary. New evidence or a run/flag/segment change invalidates the review. A configured critic is required for conclusive output. An inconclusive result is always possible with explicit caveats.

A conclusive verdict must cite, or name in a caveat, every evidence item whose stance is `contradicts`.

## Continuation and authority

The public `session_stop` hook returns `continue:true` with bounded model context. It never returns an indefinitely blocking stop decision. The host's advisory cap and the configured per-pass cap both apply. Repeated delivery of the same session/pass/turn stop ID is idempotent.

Pending user messages take precedence. Aborted signals, terminal agent errors and explicit pause/cancel stop auto-continuation. Automatic host retries marked `willContinue` are left to the host. Existing OMP goal state is never inspected or mutated.

Time, tool, subagent, token and cost budgets are checkpoints (next acquisition call, next stop), not process kill switches. Tokens and cost come from main-session `message_end` usage plus the usage of governed subagents (below). See `SECURITY.md`.

## Delegation boundary

Parent policy allows explicit native `scout` task requests only and rejects custom eval-defined tools. Each `task` call costs one acquisition tool call; each of its items costs one unit of `--max-children`, charged when the call starts (`tool_counted`). When the result shows fewer spawned agents than items (for example the host rejected the call's input), the difference is given back (`children_released`); a successful result without host-reported agents keeps its charge. Exploration scouts are not given a `model`, so the host's scout role (`@smol` by default) runs them, while the main session's model judges sources and writes evidence; scout leads are never evidence.

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
