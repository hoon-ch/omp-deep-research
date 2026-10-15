# Java client

```java
var producer = new KestrelProducer(Map.of("bootstrap", "localhost:7421"));
```

`request.timeout.ms` defaults to 15000 (15 seconds) in the Java client.
