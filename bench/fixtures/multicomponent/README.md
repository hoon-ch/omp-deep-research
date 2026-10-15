# conveyor

Monorepo for the conveyor job system.

- `packages/api` — HTTP API that enqueues jobs
- `packages/worker` — consumes and executes jobs
- `packages/cli` — operator command line tool
- `packages/shared` — helpers shared by the packages above

See `docs/configuration.md` for environment variables.
