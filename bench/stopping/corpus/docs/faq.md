# Frequently asked questions

> Written for Kestrel 1.4 (2025-05-10).

**How long does Kestrel keep messages?**
By default Kestrel keeps messages for 168 hours (7 days) after the segment closes.
Set `retention.hours` to change it.

**Which port does Kestrel use?**
The broker protocol uses port 7421.

**Does Kestrel compress data?**
No, data is stored uncompressed unless you choose a codec.

**Can I run Kestrel without ZooKeeper-like services?**
Not yet; an external coordination service is required in 1.x.
