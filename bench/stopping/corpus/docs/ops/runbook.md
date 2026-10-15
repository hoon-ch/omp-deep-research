# Production runbook

## Starting a broker

Run `kestrel serve` under a process supervisor (systemd, Kubernetes).

## Graceful shutdown

Send `SIGTERM` to the broker process. On `SIGTERM` the broker stops accepting new
connections, waits for in-flight writes to be replicated (up to
`shutdown.drain_timeout_ms`) and transfers partition leadership before exiting.
Kubernetes sends `SIGTERM` on pod deletion, so set `terminationGracePeriodSeconds` above
the drain timeout.

`SIGKILL` skips the drain and may force an unclean leader election.

## Development mode

`kestrel dev` starts a single in-memory broker. It exits immediately on `Ctrl-C`
(`SIGINT`) without draining; do not use it in production.

## Disk pressure

When a data volume exceeds 90% usage the broker rejects produce requests for the
affected partitions until retention frees space.
