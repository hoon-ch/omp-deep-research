# Configuration reference

> Applies to Kestrel 2.2. Last updated 2026-06-02.

Settings are read from `kestrel.toml` or from `KESTREL_<NAME>` environment variables.

## Network

| Setting | Default | Description |
|---|---|---|
| `listen_port` | `7421` | TCP port of the broker protocol. |
| `admin_port` | `7422` | HTTP admin and metrics port. |
| `server.request_timeout_ms` | `120000` | Server-side limit for a single request. |

## Storage

| Setting | Default | Description |
|---|---|---|
| `retention.hours` | `72` | How long closed segments are kept. |
| `segment.bytes` | `268435456` | Size at which a segment is rolled. |
| `message.max_bytes` | `1048576` | Largest accepted record (1 MiB). |
| `compression.codec` | `none` | Codec for new topics: `none`, `gzip`, `lz4`. |

## Replication

| Setting | Default | Description |
|---|---|---|
| `replication.factor` | `5` | Replicas per partition for new topics. |
| `replication.min_insync` | `3` | Replicas that must acknowledge an `acks=all` write. |

## Controller

| Setting | Default | Description |
|---|---|---|
| `controller.election_timeout_ms` | `1500` | Election timeout of the controller quorum. |
| `controller.heartbeat_ms` | `150` | Heartbeat interval of the active controller. |

## Consumers

| Setting | Default | Description |
|---|---|---|
| `consumer.session_timeout_ms` | `30000` | Time before an unresponsive consumer is removed. |
| `group.max_members` | `1000` | Hard cap on members of a single consumer group. |

## Shutdown

| Setting | Default | Description |
|---|---|---|
| `shutdown.drain_timeout_ms` | `30000` | How long a graceful shutdown waits for in-flight writes. |
