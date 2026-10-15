# Monitoring

The admin port (`admin_port`, default 7422) serves Prometheus metrics at `/metrics`.

Key metrics:

- `kestrel_under_replicated_partitions` – partitions with fewer in-sync replicas than the factor.
- `kestrel_request_latency_seconds` – histogram per request type.
- `kestrel_controller_elections_total` – Raft elections started by the controller quorum.
- `kestrel_disk_used_ratio` – data volume usage.
