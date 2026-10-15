# Kestrel

Kestrel is a log-structured message broker for small and medium clusters.
It stores records in append-only segments, replicates them across brokers and
serves them to producers and consumer groups over a binary TCP protocol.

## Quickstart

```sh
kestrel serve --data-dir ./data
```

The broker listens on TCP port 7421 unless `listen_port` is set. Point a client at
`localhost:7421` and create a topic:

```sh
kestrel topic create orders --partitions 6
```

Clients time out after 10 seconds by default; see the client guides under
`clients/` for language-specific settings.

## Documentation

- `docs/configuration.md` – configuration reference
- `docs/architecture.md` – design overview
- `docs/limits.md` – documented operational limits
- `docs/ops/runbook.md` – operating a production cluster
- `docs/releases/` – release notes
- `CHANGELOG.md` – all changes by version

## License

Kestrel is licensed under the Apache License, Version 2.0. See `LICENSE`.
