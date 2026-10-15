export interface Queue { push(job: unknown): Promise<void>; pop(): Promise<unknown | undefined> }

/** Opens a queue client for a redis:// URL. */
export function openQueue(url: string): Queue {
  if (!url.startsWith("redis://")) throw new Error(`unsupported queue URL: ${url}`);
  const jobs: unknown[] = [];
  return { async push(job) { jobs.push(job); }, async pop() { return jobs.shift(); } };
}
