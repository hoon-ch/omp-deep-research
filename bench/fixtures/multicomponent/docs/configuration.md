# Configuration

| Variable | Used by | Purpose |
|---|---|---|
| `QUEUE_URL` | api, worker, cli | Redis connection string for the job queue |
| `API_PORT` | api | HTTP listen port (default 3000) |
| `WORKER_CONCURRENCY` | worker | Parallel jobs per worker (default 4) |
