# Why we moved to Raft (blog, 2026-02-02)

Kestrel 2.0 replaced the external coordination service with an embedded Raft quorum.
Elections now complete in a few hundred milliseconds in our test clusters.
