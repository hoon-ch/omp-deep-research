import { requireEnv, envOr } from "../../shared/src/env.ts";
import { openQueue } from "../../shared/src/queue.ts";

// Workers must never silently attach to a developer's local Redis.
const queue = openQueue(requireEnv("QUEUE_URL"));
const concurrency = Number(envOr("WORKER_CONCURRENCY", "4"));

async function loop() {
  for (;;) {
    const job = await queue.pop();
    if (job === undefined) { await new Promise(r => setTimeout(r, 500)); continue; }
    console.log("ran", job);
  }
}
for (let i = 0; i < concurrency; i++) void loop();
