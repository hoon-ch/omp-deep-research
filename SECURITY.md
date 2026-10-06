# Security and privacy

This extension is an in-process research workflow, not a sandbox or security boundary.

- The default parent-tool policy blocks direct product writes, unknown tool names, mutating `github` operations, and bash/eval. It does not defend against malicious installed extensions, redefined tools, native user shell commands, OS-level actors, or an operator who disables the policy.
- `--harness` is an explicit user opt-in for data/mixed missions. It limits writes to a regular, unlinked `<cwd>/autoresearch.sh` and execution to exactly `bash autoresearch.sh`, but the harness body is agent-written code that runs with your privileges and can modify files or reach the network. Review the harness (its `write` is a recorded receipt) and use a disposable workspace.
- During an intake, only control tools (`deep_research`, `ask`, `todo`, `wait`, `think`) run. The agent's `op:"start"` sets objective, mode, constraints and deliverables; budgets, `--harness`, `--allow-exec` and the critic come only from the operator command.
- `--allow-exec` is an explicit user opt-in for interpreters in data/mixed missions. Such execution can modify files or contact the network even though the research instructions forbid product implementation. Use a disposable workspace/container for untrusted data or experiments. Native OMP approvals are not disabled.
- Delegation permits only explicit native `scout` tasks without custom tools. Read-only child behavior relies on the host's agent definition, not this extension's own containment. A parent tool allowance is not a nested-agent cost budget. Do not redefine scout to grant write capabilities.
- Acquisition and wall-clock budgets are checked at parent call/settle boundaries. They are not hard token/currency limits, do not count each nested agent tool call, and do not kill already-running commands. The advisory continuation budget is not a cap on every model-internal tool step.
- Source text is not injected into the system prompt. Receipts and evidence remain untrusted data. A receipt proves an observed tool result, not source truth, quote entailment, safe commands, benchmark validity, or authentic independent model identity.
- OMP stores session entries using its existing session persistence. Exports use owner-only file permissions where supported and refuse pre-existing symlink directories, but are not an adversarial multi-process filesystem sandbox.
- Session data and exports can contain local file paths, query results, proprietary facts and small source previews. There is no telemetry or automatic publication. Do not publish `.omp/`, session files, secrets, or research reports without review.
- `clear` retires a mission logically; it is not secure deletion. Source records remain in the underlying OMP session until the operator removes that session using the host's own controls.
- The publish helper defaults to a private repository, checks the authenticated account is `hoon-ch`, refuses existing repositories/remotes, uses an explicit source-file allowlist, and never force-pushes. Do not paste GitHub tokens into prompts or this project.

Report vulnerabilities privately to the repository owner through an available private GitHub channel. Do not include secrets in public issues. No private-reporting channel is assumed to exist before the repository is created.
