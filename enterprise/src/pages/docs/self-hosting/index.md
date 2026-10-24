---
layout: ../../../layouts/Docs.astro
title: Deploying
lead: One Rust binary, a sandbox worker next to it, and a Postgres database. What to run, what to expose, and what the server checks before it serves traffic.
---

## What you deploy

| Piece | |
|---|---|
| `happy-enterprise` | the server: both APIs, migrations, the MCP server and OAuth pages |
| `happy-enterprise-monty-worker` | the sandbox for [custom validators](/docs/concepts/validators/), started as subprocesses by the server. Put it next to the server binary (found automatically) or point `MONTY_WORKER` at it |
| Postgres 16+ | everything is stored here: no Redis, no queue |
| a blob store | a local directory, or an S3-compatible bucket |
| an email provider | Resend, SES, SMTP, or your own webhook |

Build both binaries with:

```sh
cargo build --release -p happy-enterprise --bins
# target/release/happy-enterprise
# target/release/happy-enterprise-monty-worker
```

Without the worker (or with `MONTY_WORKER=off`), everything works except
writes that owe custom validator calls, which get `503
validators_unavailable`.

## Two listeners

| | Organization API | Management API |
|---|---|---|
| Address | `TENANT_LISTEN_ADDR`, default `0.0.0.0:8080` | `MANAGEMENT_LISTEN_ADDR`, default `127.0.0.1:9090` |
| Exposure | public, behind your reverse proxy | private: operators and provisioning only |
| Credentials | sessions, external JWTs, agent API tokens, OAuth | Ed25519 JWTs from `MANAGEMENT_JWT_PUBLIC_KEYS` |
| Database role | `happy_enterprise_tenant` | `happy_enterprise_management` |

The two share no routes, credentials, or database roles. Never put the
management listener on the public network.

## Behind a reverse proxy

Terminate TLS in front of the organization API listener and set `PUBLIC_BASE_URL` to
the public origin (no path), for example `https://api.acme.example`. OAuth
issuers, MCP resource URLs, invite links, and the WebAuthn relying party all
derive from it.

* **Client IPs.** Rate limits key on the client IP. Behind a proxy, set
  `CLIENT_IP_HEADER` to the header it sets (`x-real-ip`, or
  `x-forwarded-for`, whose last entry is used). Only set it if the proxy
  overwrites the header; otherwise clients can choose their own IP.
* **Host checks.** The MCP endpoint accepts only the `Host` values in
  `MCP_ALLOWED_HOSTS` (by default the host of `PUBLIC_BASE_URL`). If the
  proxy rewrites `Host`, list what arrives.
* **Streaming.** `GET /v1/ontology/events` is a long-lived server-sent event
  stream. Disable response buffering for it, and let idle connections live longer
  than the 15 seconds between the server's keep-alive comments.
* **Body sizes.** Image uploads are up to 5 MB.

## Database

The first migration creates the two runtime roles, `LOGIN NOSUPERUSER
NOBYPASSRLS` and without passwords. In production, give them passwords (or
another authentication method in `pg_hba.conf`) as an administrator:

```sql
ALTER ROLE happy_enterprise_tenant PASSWORD '...';
ALTER ROLE happy_enterprise_management PASSWORD '...';
```

| Variable | Role | Used for |
|---|---|---|
| `DATABASE_URL` | schema owner, may create roles | running migrations at startup, and nothing else |
| `TENANT_DATABASE_URL` | `happy_enterprise_tenant` | the organization API (pool of 20); row-level security applies |
| `MANAGEMENT_DATABASE_URL` | `happy_enterprise_management` | the management API (pool of 5); only the list of organizations and their identity provider keys |

**Migrations.** By default the server applies pending migrations on startup
with `DATABASE_URL`. To run them separately (from a release job, say), set
`RUN_MIGRATIONS=false` on the servers; `DATABASE_URL` is then optional. Roles
are cluster-wide, so several databases in one cluster share them.

**Startup checks.** Before serving traffic, the server checks that each
pool is logged in as exactly its expected role and that the role is neither
a superuser nor `BYPASSRLS`, and refuses to start otherwise. The migrations
make the same assertion. A misconfigured URL fails loudly instead of quietly
disabling isolation between organizations.

## Secrets

* `SERVER_SECRET_KEY`: 32 random bytes, base64url without padding. It
  derives each organization's session signing key (HKDF) and seals TOTP
  secrets. Rotating it logs everyone out and invalidates every TOTP factor.
* `MANAGEMENT_JWT_PUBLIC_KEYS`: public keys only. Keep the private keys
  with whoever provisions organizations.
* Email and S3 credentials, as listed in
  [Configuration](/docs/self-hosting/configuration/).

## Replicas

The server keeps no state between requests beyond what is in Postgres,
with two exceptions that are per replica: rate-limit windows, and the limit
of 20 open event streams per user. With `n` replicas, a key's effective
limit is up to `n` times the configured one. Live event streams on every
replica are woken by Postgres `NOTIFY`, so writes on one replica reach
streams on another.

## Files

`STORAGE_BACKEND=local` stores blobs under `STORAGE_LOCAL_DIR` (default
`data/files`). Every replica must see the same directory. Unfinished uploads
older than an hour are swept at startup. `STORAGE_BACKEND=s3` uses a bucket
(AWS, or a compatible server with `S3_ENDPOINT`, path-style). The server
proxies every download, so the bucket never needs to be public.

## Shutdown

On `SIGINT` or `SIGTERM` the server stops accepting connections and lets
in-flight requests finish before exiting.
