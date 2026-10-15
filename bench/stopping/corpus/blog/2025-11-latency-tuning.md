# Tuning Kestrel for low latency (blog, 2025-11-04)

For latency-sensitive services we recommend setting the client request timeout to 5
seconds so that callers fail fast and retry against another broker. Pair this with
`lz4` compression to keep batches small. (At the time of writing lz4 had to be enabled
explicitly.)
