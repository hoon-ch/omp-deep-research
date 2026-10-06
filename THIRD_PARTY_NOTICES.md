# Third-party provenance and notices

This is an independent OMP-native implementation inspired by the research workflow in [Gajae Code](https://github.com/Yeachan-Heo/gajae-code), not an official Gajae Code or OMP product and not a verbatim port of their runtime. The workflow adaptation acknowledges Gajae's web/data/mixed modes, cold intake, `autoresearch.sh` harness contract, research-only boundary, durable evidence/run records, critic receipts, and conclusive/inconclusive verdicts.

`src/briefs.ts` adapts the review checklist, read-only role and missing-context fallback of Gajae's `auto-critic.md` (blob `da6c3f6d1a36d2ba390cfd30bcb69df38315edfe`) and the planner role, rules and fallback of `auto-iterate.md` (blob `d2e2078ab0d9a23564dce9fd1231ee82d890f196`), both under `packages/coding-agent/src/defaults/gjc/skills/autoresearch/` at commit `1a76298142decaf48b811d480273c703bce2f637`; the response shapes were changed to this extension's records. `src/spec.ts` follows the spec-intake conventions of Gajae's `autoresearch-runtime.ts`, and `src/runs.ts` the MAD-based run confidence of Gajae's `autoresearch/runs.ts`; no code was copied. Upstream may have changed since.

No Gajae executable, Python kernel owner, state CLI, or vendored runtime code is included. OMP's built-in `/autoresearch` is untouched. OMP public API examples informed the adapter; the host itself is not distributed in this package. See `docs/COMPATIBILITY.md` for reviewed source blobs and verification limits.

## Gajae Code — MIT License

Copyright (c) 2025-2026 Yeachan-Heo and Gajae Code Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
