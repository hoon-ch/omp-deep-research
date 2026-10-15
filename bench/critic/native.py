"""Run one native OMP autoresearch experiment in a supplied disposable checkout.

This is an RPC transport, not an implementation of run_experiment: the native OMP
model receives /autoresearch, then calls the actual native experiment tools. The
receipt preserves tool arguments/results and model usage without private reasoning.
"""
import argparse
import asyncio
import json
import os
import pathlib

parser = argparse.ArgumentParser()
parser.add_argument("--cwd", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()


async def main():
    # Native discard/checks_failed reverts run-modified checkout files. Keep raw model usage/answers outside that scope.
    raw_results = pathlib.Path(args.out).resolve().with_suffix(".critic-results")
    proc = await asyncio.create_subprocess_exec(
        "omp", "--mode", "rpc", "--no-ui", "--no-title", "--no-session",
        "--model", "openai-codex/gpt-6.1-sol", "--thinking", "minimal",
        "-e", str(pathlib.Path(__file__).with_name("native-tools.ts").resolve()),
        "--auto-approve", cwd=args.cwd, stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=1 << 26,
        env={**os.environ, "CRITIC_BENCH_RESULTS_DIR": str(raw_results)},
    )
    frames = []

    async def send(payload):
        proc.stdin.write((json.dumps(payload) + "\n").encode())
        await proc.stdin.drain()

    prompt = (
        "Run exactly ONE native autoresearch experiment in this disposable checkout. "
        "Do not implement or edit any source, fixtures, tests, scoring or benchmark. "
        "Use init_experiment if required with metric critic_input_tokens, lower is better, "
        "The required ./autoresearch.sh already delegates to the benchmark. "
        "Call native run_experiment (timeout_seconds 900); it automatically runs that entrypoint. "
        "Do not substitute bash or a fabricated tool for native run_experiment. "
        "Read native tool errors and correct tool arguments if necessary. "
        "Use log_experiment to record actual metrics and checks. Parser-cap failures may exist in "
        "the original baseline; use actual output, never assume their count. Accuracy/attestation "
        "failures are checks_failed even when the token metric improves. Do not change files. "
        "After ONE successful run_experiment execution and log_experiment, return its metric and STOP."
    )
    try:
        await send({"id": "activate", "type": "prompt", "message": "/autoresearch"})
        stage = 0
        while True:
            line = await asyncio.wait_for(proc.stdout.readline(), timeout=600)
            if not line:
                break
            frame = json.loads(line)
            kind = frame.get("type")
            if kind == "prompt_result" and frame.get("id") == "activate" and stage == 0:
                stage = 1
                await send({"id": "tools", "type": "prompt", "message": "/critic-bench-native-tools"})
            elif kind == "prompt_result" and frame.get("id") == "tools" and stage == 1:
                stage = 2
                await send({"id": "experiment", "type": "prompt", "message": prompt})
            if kind in ("tool_execution_start", "tool_execution_end", "prompt_result", "session_settled"):
                frames.append(frame)
                print(json.dumps(frame), flush=True)
            if kind == "message_end":
                message = frame.get("message", {})
                frames.append({"type": "message_end", "role": message.get("role"),
                    "usage": message.get("usage"), "model": message.get("model"),
                    "content": [c for c in message.get("content", []) if c.get("type") in ("text", "toolCall")]})
            if stage == 2 and (kind == "session_settled" or (kind == "agent_end" and frame.get("isTerminal"))
                or (kind == "prompt_result" and frame.get("id") == "experiment" and frame.get("sessionSettled"))):
                break
    finally:
        pathlib.Path(args.out).write_text("".join(json.dumps(f) + "\n" for f in frames))
        proc.terminate()
        await proc.wait()
    executed = [f for f in frames if f.get("type") == "tool_execution_end"
        and f.get("toolName") == "run_experiment" and
        isinstance(f.get("result", {}).get("details", {}).get("runNumber"), int)]
    logged = [f for f in frames if f.get("type") == "tool_execution_end"
        and f.get("toolName") == "log_experiment" and
        f.get("result", {}).get("details", {}).get("experiment")]
    if not executed or not logged:
        raise RuntimeError("Native experiment did not execute and log; inspect the preserved RPC receipt.")
    if any(not f["result"]["details"].get("passed") for f in executed):
        raise RuntimeError("Native benchmark execution failed; inspect the preserved run log and RPC receipt.")


asyncio.run(main())
