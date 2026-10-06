# Compatibility and upstream mapping

Reviewed on **2026-10-06**. Upstream `main` files may change; blob IDs below identify the exact retrieved file contents, not a tested full upstream checkout or a release commit.

| Upstream file | Observed Git blob SHA |
|---|---|
| OMP `packages/coding-agent/package.json` (declares `18.6.2`) | `cc9873535f2d007d4eaf5066b8655bea5595d01e` |
| OMP `packages/coding-agent/src/extensibility/extensions/types.ts` | `3dec4e6ac286199555e202829e20a6f54ac97f90` |
| OMP `packages/coding-agent/src/extensibility/shared-events.ts` | `6317bc3bba50655f24a42e3f07adf4df36269373` |
| OMP `packages/coding-agent/src/prompts/tools/task.md` | `c5e45bdf28e89b055d77bc1dc5cffe075e453566` |
| Gajae `packages/coding-agent/src/defaults/gjc/skills/autoresearch/SKILL.md` | `d036174007c4bc736ab3ced9a8710fd7ad59a7a4` |
| Gajae `LICENSE` | `16eb3fc020a9dbefb165d2fb1d4597d2203c44bd` |

## Primary references

- [OMP extension API](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md)
- [OMP discovery/loading](https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md)
- [OMP public extension types](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts)
- [OMP shared event types](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/shared-events.ts)
- [OMP task instructions](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/prompts/tools/task.md)
- [Gajae research workflow](https://github.com/Yeachan-Heo/gajae-code/blob/main/packages/coding-agent/src/defaults/gjc/skills/autoresearch/SKILL.md)

The host contract uses `pi.zod`, `registerTool`, `registerCommand`, `appendEntry`, `sendUserMessage(...,{attribution:'agent'})`, `before_agent_start`, `tool_call`, `tool_result`, `agent_end`, `session_stop`, and active-branch reads. `session_stop` is notification/continuation integration, not an internal Goal controller. This implementation needs the modern event and schema surfaces above; it does not advertise backward compatibility with every earlier OMP release.

## Gajae → this implementation

| Gajae concept | Implementation here |
|---|---|
| web/data/mixed missions | explicit command config and mode-checked evidence |
| CLI-backed mission state | `deep_research` tool + public OMP custom session entries |
| run ledger | receipt-backed parsed metrics and append-only run/flag events |
| durable notes | `notes_updated` events |
| structured verdict | evidence-linked findings, disposition, confidence, caveats |
| optional critic receipt | complete-snapshot digest and declared reviewer receipt |
| cooperative GJC goal integration | bounded public OMP `session_stop` advisory requests |
| global/session Python ownership | reuse existing host tools; no kernel implementation or reset |
| GJC conclusive mission auto-clear | keep completed mission visible until explicit clear/new start |
| GJC cold-intake questions/spec parsing | direct explicit command configuration; no GJC spec compatibility |

## Known gaps

This is not a byte-for-byte port, a GJC file-format importer, or a replacement for GJC's runtime. It does not implement a contradiction graph, automatic multi-lane scheduler, calibrated evidence scoring, cross-session merging, hard token/currency limits, or an independently attested reviewer protocol. Existing host tools perform actual web search, reading, model calls, and optional experiments.

A Bun/OMP/provider-backed end-to-end run remains required before treating this as production-ready. The repository's local host contract tests exercise the adapter's behavior but do not load the real OMP factory loader or its omptype/Zod builder. An OMP source version string is not evidence that those tests were run.
