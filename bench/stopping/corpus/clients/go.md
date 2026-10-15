# Go client

```go
p, err := kestrel.NewProducer("localhost:7421", kestrel.WithTimeout(10*time.Second))
```

The Go client's default request timeout is 10 seconds (`kestrel.DefaultTimeout`).
