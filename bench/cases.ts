/**
 * Frozen scout-allocation benchmark cases (segment 0, 2026-10-15). Do not edit during an experiment: a change to a case,
 * its flags, fixtures or expectations makes earlier runs incomparable and needs a new segment and baseline.
 *
 * - `groups`: evidence coverage; each group is satisfied by one recorded evidence locator matching any of its patterns.
 * - `facts`: the expected conclusion; each must appear in the verdict text (summary, findings, caveats).
 * - `forbidden`: incorrect conclusions; any match makes the answer wrong.
 */
export interface BenchCase {
  id: string; category: string; mode: "web" | "data"; objective: string; flags: string[]; fixture?: string;
  groups: Record<string, RegExp[]>; facts: Record<string, RegExp>; forbidden: Record<string, RegExp>;
  requireCritic?: boolean; maxChildren: number;
}

/** Budget flags shared by every case: bounded cost, but loose enough not to decide a correct mission's outcome. */
export const COMMON_FLAGS = ["--budget", "3", "--max-tools", "30", "--max-minutes", "12", "--max-tokens", "3000000", "--max-cost", "5"];

export const CASES: BenchCase[] = [
  { id: "A-simple", category: "A simple question, one authoritative source", mode: "web", flags: [], maxChildren: 8,
    objective: "In SQLite, what is the default maximum number of attached databases (SQLITE_MAX_ATTACHED)?",
    groups: { sqlite: [/sqlite\.org/] }, facts: { ten: /\b10\b/ }, forbidden: {} },
  { id: "B-two", category: "B comparison, two independent investigations", mode: "web", flags: [], maxChildren: 8,
    objective: "Compare the default value of max_connections in PostgreSQL 17 with the default value of max_connections in MySQL 8.4.",
    groups: { postgres: [/postgresql\.org\/docs\/17\//], mysql: [/dev\.mysql\.com\/doc\/refman\/8\.4\//] },
    facts: { pg100: /\b100\b/, mysql151: /\b151\b/ }, forbidden: {} },
  { id: "C-multi", category: "C complex comparison, multiple projects", mode: "web", flags: [], maxChildren: 8,
    objective: "For Redis 7.4, Valkey 8.0 and KeyDB, determine under which license each is distributed and the default TCP port of each server.",
    groups: { redis: [/redis\.io|github\.com\/redis\/redis|githubusercontent\.com\/redis\/redis/i], valkey: [/valkey/i], keydb: [/keydb/i] },
    facts: { redisLicense: /RSAL|SSPL/i, bsd: /BSD/, port: /6379/ }, forbidden: {} },
  { id: "D-contradict", category: "D contradictory evidence", mode: "data", fixture: "contradiction", flags: [], maxChildren: 8,
    objective: "What is the default request timeout of the relay service in this repository? Check the documentation against the code and report any disagreement.",
    groups: { code: [/src\/config\.js/], docs: [/README\.md|CHANGELOG\.md/] },
    facts: { code60: /\b60\s*(?:s\b|sec|seconds)|60[,_ ]?000/i, docs30: /\b30\s*(?:s\b|sec|seconds)|30[,_ ]?000/i },
    forbidden: { docsWins: /default (?:request )?timeout (?:is|=|of) (?:30|30[,_ ]?000)\b/i } },
  { id: "E-repo", category: "E repository investigation, multiple components", mode: "data", fixture: "multicomponent", flags: [], maxChildren: 8,
    objective: "Which packages in this repository read the QUEUE_URL environment variable, and what happens in each when it is not set (default value or failure)?",
    groups: { api: [/packages\/api\/src\/config\.ts/], worker: [/packages\/worker\/src\/main\.ts/], cli: [/packages\/cli\/src\/index\.ts/] },
    facts: { api: /localhost:6379\/0/, cli: /127\.0\.0\.1:6379\/1/, worker: /requireEnv|must be set|throws?|no default|fails?/i },
    forbidden: {} },
  { id: "F-overlap", category: "F overlapping, redundant sub-questions", mode: "web", flags: [], maxChildren: 8,
    objective: "For TypeScript 5.8: what is the minimum supported Node.js version, what does the engines field of the typescript package declare, and which Node.js versions can run tsc 5.8?",
    groups: { typescript: [/typescript/i] }, facts: { node1417: /14\.17/ }, forbidden: {} },
  { id: "G-parallel", category: "G parallel exploration helps", mode: "web", flags: [], maxChildren: 8,
    objective: "For Deno, Bun, Node.js and Cloudflare Workers, find the official documentation for reading environment variables and the exact API each uses.",
    groups: { deno: [/deno\.(?:com|land)/], bun: [/bun\.(?:sh|com)/], node: [/nodejs\.org/], workers: [/developers\.cloudflare\.com/] },
    facts: { deno: /Deno\.env\.get/, bun: /Bun\.env/, node: /process\.env/, workers: /cloudflare:workers|env\.[A-Za-z_]+|`?env`? (?:parameter|object|argument|binding)/i },
    forbidden: {} },
  { id: "H-oneSource", category: "H parallel exploration is unnecessary", mode: "web", flags: [], maxChildren: 8,
    objective: "What are the default values of shared_buffers, work_mem and maintenance_work_mem in PostgreSQL 17?",
    groups: { postgres: [/postgresql\.org\/docs\/17\//] }, facts: { shared: /128\s*MB/i, work: /\b4\s*MB/i, maint: /\b64\s*MB/i }, forbidden: {} },
  { id: "I-budget", category: "I near the remaining scout budget", mode: "web", flags: ["--max-children", "1"], maxChildren: 1,
    objective: "When were Python 3.12.0 and Python 3.13.0 released, and when does each reach end of life?",
    groups: { py312: [/pep-0693|devguide\.python\.org\/versions|python-3120|peps\.python\.org/], py313: [/pep-0719|devguide\.python\.org\/versions|python-3130|peps\.python\.org/] },
    facts: { r312: /2023-10-02|October 2,? 2023|2 October 2023/, r313: /2024-10-07|October 7,? 2024|7 October 2024/, eol312: /2028/, eol313: /2029/ },
    forbidden: {} },
  { id: "J-critic", category: "J configured independent critic", mode: "data", fixture: "critic", flags: ["--critic", "@review_worker"], maxChildren: 8,
    requireCritic: true,
    objective: "Which password hashing algorithm and how many iterations does this repository use to store passwords?",
    groups: { password: [/src\/password\.js/] }, facts: { pbkdf2: /PBKDF2/i, iterations: /600[,_ ]?000/, sha256: /SHA-?256/i }, forbidden: {} },
];
