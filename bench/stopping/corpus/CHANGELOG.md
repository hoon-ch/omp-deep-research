# Changelog

All notable changes to Kestrel. Dates are release dates (UTC).

## 2.4.1 — 2026-10-02 (latest)

- Fix: consumer offsets could be committed twice after a coordinator failover.
- Fix: `kestrel topic describe` printed the wrong ISR count.

## 2.4.0 — 2026-09-15

- Added: optional `zstd` codec for `compression.codec` (opt-in; the default is unchanged).
- Added: `kestrel cluster drain` command.
- Changed: `consumer.session_timeout_ms` default lowered from 30000 to 10000.

## 2.3.0 — 2026-08-20

- Changed: the default `compression.codec` is now `lz4` (was `none`). Existing topics keep
  their configured codec; topics created without an explicit codec use `lz4`.
- Added: per-topic retention overrides via `kestrel topic alter --retention-hours`.

## 2.2.0 — 2026-05-28

- Added: `segment.bytes` setting (default 268435456 bytes).
- Fixed: rare leader flapping when `controller.election_timeout_ms` was below 500.

## 2.0.0 — 2026-01-12

- Changed: default `retention.hours` lowered from 168 (7 days) to 72 (3 days).
- Changed: wire protocol v2; v1 clients are no longer supported.
- Added: Raft-based controller quorum replaces the external coordination service.

## 1.4.0 — 2025-05-03

- Added: consumer groups with cooperative rebalancing.

## 1.0.0 — 2025-03-01

- First stable release.
