# Architecture

> Applies to Kestrel 2.x.

## Overview

A Kestrel cluster is a set of brokers. Each topic is split into partitions; each
partition is an ordered log of append-only segments stored on one leader broker and
copied to follower brokers.

## Controller quorum

Since 2.0 the cluster metadata (topics, partition leaders, broker membership) is owned
by the controller quorum, three or five brokers that run the Raft consensus protocol.
The controller quorum elects its own leader with Raft; the active controller in turn
assigns partition leaders. If the active controller stops sending heartbeats, the
remaining controllers start a new Raft election after the election timeout.

## Replication

A write with `acks=all` is acknowledged once the configured number of in-sync replicas
has persisted it. Followers that fall behind leave the in-sync set until they catch up.

## Consumer groups

Each consumer group is managed by a group coordinator on one broker. The coordinator
assigns partitions to members and stores committed offsets. A consumer group can have
at most 512 members; the coordinator rejects further join requests.

## Delivery semantics

Kestrel provides at-least-once delivery. Idempotent producers avoid duplicates caused by
producer retries.
