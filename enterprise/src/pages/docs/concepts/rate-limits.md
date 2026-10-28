---
layout: ../../../layouts/Docs.astro
title: Rate limits
lead: Sliding-window limits protect login, passwords, second factors, and OAuth. They are keyed on what a request names, before any lookup, so unknown organizations and addresses are limited exactly like real ones.
---

## Defaults

| What | Per IP | Per account |
|---|---|---|
| Login codes (`email/start`, the OAuth email step) | 30 per 10 minutes | 5 per 15 minutes per organization and address |
| Code checks, invite acceptance, password sign-in, set-password links | 60 per 10 minutes | (5 attempts per code) |
| [Passwords](/docs/concepts/authentication/#failed-attempts): sign-ins, step-ups and changes (organizations and management) | locked after 5 failures per account and IP: 1 minute, doubling to 1 hour | past 20 attempts in 15 minutes, each waits 1 second; never locked |
| Second-factor attempts (REST and OAuth pages) | 60 per 15 minutes | 20 per 15 minutes per user, across sessions (10 failures also end a session) |
| OAuth token and revocation | 120 per minute | 60 per minute per client |
| OAuth client registration | 20 per hour | 100 per hour per organization |
| Action emails to outside addresses | | 200 per hour per organization; deliveries over the limit wait |
| [Timeseries](/docs/concepts/timeseries/) ingest (REST and MCP) | | 600 batches per minute per organization, 120 per minute per user |
| [Chat](/docs/concepts/chat/) posts, edits, reactions, and pins (REST and MCP) | | 120 per minute per user |
| Chat typing notices | | 30 per minute per user |
| [Connector](/docs/concepts/connectors/) tool calls (MCP) | | 120 per minute per user |
| [Management](/docs/self-hosting/operators/) setup, sign-in, step-up, and enrollment | 30 per 10 minutes | 600 per 10 minutes in all |
| [Filesystem](/docs/concepts/filesystem/) writes: new folders, uploads, renames, moves, deletions, restores (REST and MCP) | | 300 per minute per user |

## Behavior

A request counts against **all** of its keys, or, if any of them is
exhausted, against **none**: a refused request uses nothing up. Refused
requests get `429` with a `Retry-After` header in whole seconds:

```http
429 Too Many Requests
Retry-After: 37

{ "error": { "code": "rate_limited", "message": "too many requests; try again later" } }
```

OAuth endpoints answer in the OAuth error format instead, and the sign-in
pages show a message.

Keys come from what the request names (the organization in the path, the
email address in the body, the client id in the form), never from what a
database lookup found. So an attacker cannot tell, from the limits, whether
an organization or address exists.

Limits are kept in memory, so each replica enforces its own. Behind a load
balancer with *n* replicas, the effective limit is up to *n* times the
numbers above.

## Client IP

By default the client IP is the TCP peer. Behind a reverse proxy, set
`CLIENT_IP_HEADER` to the header your proxy sets (for example `x-real-ip`, or
`x-forwarded-for`, of which the last entry is used). Only set it if the proxy
overwrites the header: otherwise clients can choose their own IP. Because
the last entry is used, the proxy next to the server must pass
`X-Forwarded-For` through unchanged rather than append to it; see
[Docker](/docs/self-hosting/docker/#behind-a-reverse-proxy).

Within any window a key accepts at most its limit, and refused requests use
up nothing.
