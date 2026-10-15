"""Exercise the shipped extension and actual task critic in an isolated LICENSE mission.

Only tool results, public assistant output/usage and custom research ledger entries
are retained. The RPC stream limit accommodates history frames larger than 64 KiB.
"""
import argparse
import asyncio
import json
import pathlib
import shutil
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
args = parser.parse_args()
repo = pathlib.Path(__file__).resolve().parents[2]
workspace = pathlib.Path(tempfile.mkdtemp(prefix="critic-packet-live-"))
shutil.copy2(repo / "LICENSE", workspace / "LICENSE")
(workspace / ".omp/agents").mkdir(parents=True)
shutil.copy2(repo / "agents/deep-research-critic.md", workspace / ".omp/agents/deep-research-critic.md")


async def main():
    proc = await asyncio.create_subprocess_exec(
        "omp", "--mode", "rpc", "--no-ui", "--no-title", "--no-extensions",
        "-e", str(repo / "index.ts"), "--session-dir", str(workspace / "sessions"),
        "--model", "google-antigravity/gemini-3.8-flash", "--thinking", "minimal", "--auto-approve",
        cwd=str(workspace), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL, limit=1 << 26,
    )
    frames = []

    async def send(payload):
        proc.stdin.write((json.dumps(payload) + "\n").encode())
        await proc.stdin.drain()

    await send({"id": "mission", "type": "prompt", "message":
        "/deep-research --mode data --critic @review_worker --budget 1 --max-tools 16 --max-children 2 "
        "Determine the license identifier of this checkout from LICENSE. Cite the actual file lines, "
        "record evidence, run the configured critic with the complete brief, record its response, then "
        "issue the structured verdict. Do not infer additional obligations, run commands, modify files, or use the web."})
    requested_history = False
    try:
        while True:
            line = await asyncio.wait_for(proc.stdout.readline(), timeout=300)
            if not line:
                break
            frame = json.loads(line)
            kind = frame.get("type")
            if kind in ("tool_execution_start", "tool_execution_end", "prompt_result", "session_settled"):
                frames.append(frame)
            if kind == "message_end":
                message = frame.get("message", {})
                frames.append({"type": kind, "role": message.get("role"), "usage": message.get("usage"),
                    "content": [c for c in message.get("content", []) if c.get("type") in ("text", "toolCall")]})
            if not requested_history and (kind == "session_settled" or (kind == "agent_end" and frame.get("isTerminal"))):
                requested_history = True
                await send({"id": "ledger", "type": "get_entries"})
            if frame.get("id") == "ledger":
                entries = frame.get("data", {}).get("entries")
                if not isinstance(entries, list):
                    raise RuntimeError("get_entries returned no entry array")
                frames.append({"type": "research_entries", "entries": [e for e in entries
                    if e.get("type") == "custom" and e.get("customType") == "io.github.hoon-ch.omp-deep-research.event.v1"]})
                break
    finally:
        frames.append({"type": "workspace", "path": str(workspace), "sessions": str(workspace / "sessions")})
        pathlib.Path(args.out).write_text("".join(json.dumps(f) + "\n" for f in frames))
        proc.terminate()
        await proc.wait()
    events = [e["data"] for f in frames if f.get("type") == "research_entries" for e in f["entries"]]
    critics = [e["data"]["critic"] for e in events if e.get("type") == "critic_recorded"]
    verdicts = [e["data"]["verdict"] for e in events if e.get("type") == "verdict_issued"]
    if not critics or not critics[-1].get("snapshotHash") or not verdicts or verdicts[-1].get("disposition") != "conclusive":
        raise RuntimeError("No exact-packet critic and conclusive verdict; inspect preserved RPC receipt")
    print(json.dumps({"critic": critics[-1], "verdict": verdicts[-1], "workspace": str(workspace)}))


asyncio.run(main())
