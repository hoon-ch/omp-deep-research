# Python client

Install with `pip install kestrel-client`.

```python
from kestrel import Producer

producer = Producer("localhost:7421")
producer.send("orders", b"payload")
```

## Timeouts

`Producer` and `Consumer` accept `request_timeout` in seconds. The Python client's
default `request_timeout` is 30.0 seconds; a request that gets no response in that time
raises `kestrel.TimeoutError`.

## Retries

`retries` defaults to 5 with exponential backoff starting at 100 ms.
