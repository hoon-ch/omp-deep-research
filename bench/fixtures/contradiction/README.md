# relay

`relay` forwards webhook deliveries to downstream HTTP endpoints with retries.

## Configuration

| Setting | Environment variable | Default |
|---|---|---|
| Listen port | `RELAY_PORT` | `8080` |
| Request timeout | `RELAY_TIMEOUT_MS` | `30000` (30 seconds) |
| Maximum retries | `RELAY_MAX_RETRIES` | `5` |

Requests that exceed the request timeout are retried with exponential backoff.
