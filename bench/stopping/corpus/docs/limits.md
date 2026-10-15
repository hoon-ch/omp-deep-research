# Documented limits

> Applies to Kestrel 2.x.

| Limit | Value | Notes |
|---|---|---|
| Topics per cluster | 10,000 | Tested on a 6-broker cluster. |
| Brokers per cluster | 64 | Larger clusters are untested. |
| Record size | see `message.max_bytes` | Configurable. |
| Partitions per topic | not yet characterized | No supported maximum has been published; see issue #412. |

Limits not listed here have not been measured.
