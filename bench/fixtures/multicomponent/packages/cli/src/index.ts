import { openQueue } from "../../shared/src/queue.ts";

const DEFAULT_QUEUE = "redis://127.0.0.1:6379/1";

/** The CLI prefers --queue, then QUEUE_URL, then its own development database (db 1). */
export function queueUrl(argv: string[], env = process.env): string {
  const flag = argv.indexOf("--queue");
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1]!;
  return env.QUEUE_URL || DEFAULT_QUEUE;
}

const queue = openQueue(queueUrl(process.argv.slice(2)));
await queue.push({ kind: "manual", at: Date.now() });
console.log("enqueued");
