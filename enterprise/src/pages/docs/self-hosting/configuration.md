---
layout: ../../../layouts/Docs.astro
title: Configuration
lead: Every environment variable the server reads, with its default.
---

The server reads its configuration from the environment at startup and
refuses to start if a required variable is missing or malformed.

## Database

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required if migrating | Schema owner. Used only to run migrations at startup. |
| `RUN_MIGRATIONS` | `true` | `false` skips migrations and makes `DATABASE_URL` optional. |
| `ORG_DATABASE_URL` | required | The organization API's database. Connects as `happy_enterprise_org`. |
| `MANAGEMENT_DATABASE_URL` | required | Connects as `happy_enterprise_management`. |

## Listeners and URLs

| Variable | Default | Meaning |
|---|---|---|
| `ORG_LISTEN_ADDR` | `0.0.0.0:8080` | Organization API listener. |
| `MANAGEMENT_LISTEN_ADDR` | `127.0.0.1:9090` | Management API listener. Keep it off the public network. |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Public origin of the organization API (no path). OAuth issuers and MCP resource URLs derive from it. |
| `INVITE_URL` | `<PUBLIC_BASE_URL>/invite` | Where invite links point (`?org=<id>&token=<token>` is appended). |
| `CLIENT_IP_HEADER` | none | Header with the client IP set by your reverse proxy (e.g. `x-real-ip`, or `x-forwarded-for`: last entry), for rate limits. Unset: the TCP peer. Only set it if the proxy overwrites the header. |
| `MCP_ALLOWED_HOSTS` | host of `PUBLIC_BASE_URL` | Comma-separated `Host` values (`host` or `host:port`) the MCP endpoint accepts, against DNS rebinding; `*` accepts any. |

## Keys

| Variable | Default | Meaning |
|---|---|---|
| `SERVER_SECRET_KEY` | required | 32 random bytes, base64url without padding. Derives session signing keys and seals TOTP secrets: rotating it logs everyone out and invalidates TOTP factors. |
| `MANAGEMENT_JWT_PUBLIC_KEYS` | required with `jwt` | `kid=<base64url raw 32-byte Ed25519 key>[,kid2=...]` |
| `MANAGEMENT_JWT_ISSUER` | `happy-enterprise-management` | Required `iss` of management tokens. |

Generate a server secret with:

```sh
openssl rand 32 | basenc --base64url | tr -d =
```

## Management

How [operators](/docs/self-hosting/operators/) and provisioning scripts
authenticate to the management API.

| Variable | Default | Meaning |
|---|---|---|
| `MANAGEMENT_AUTH` | `jwt` | `jwt`, `webauthn`, or `jwt,webauthn`. With `webauthn` alone no JWT is accepted, and every sensitive change needs a security-key touch. |
| `MANAGEMENT_WEBAUTHN_RP_ID` | required with `webauthn` | Relying party id of operator keys: the host of the console's origins, or a parent domain. |
| `MANAGEMENT_WEBAUTHN_ORIGIN` | required with `webauthn` | Comma-separated origins the console runs on (no paths). The first builds enrollment links. |
| `MANAGEMENT_WEBAUTHN_RP_NAME` | `Happy Enterprise management` | Name shown by authenticators. |
| `MANAGEMENT_WEBAUTHN_AAGUIDS` | none | Comma-separated AAGUIDs allowed to enroll and sign in; needs `MANAGEMENT_WEBAUTHN_ATTESTATION_CA`. Unset: any authenticator with user verification. |
| `MANAGEMENT_WEBAUTHN_ATTESTATION_CA` | none | Path of a PEM bundle of attestation root certificates, such as Yubico's FIDO root, that allowed keys' attestations must chain to. Set with `MANAGEMENT_WEBAUTHN_AAGUIDS`. |
| `MANAGEMENT_SESSION_TTL` | `900` | Seconds an operator session lasts at most. |
| `MANAGEMENT_SESSION_IDLE` | `300` | Seconds without a request after which an operator session ends. |
| `MANAGEMENT_STEP_UP_WINDOW` | `300` | Seconds after a security-key assertion during which step-up operations are allowed. |

## WebAuthn

| Variable | Default | Meaning |
|---|---|---|
| `WEBAUTHN_RP_ID` | host of `PUBLIC_BASE_URL` | Relying party id: a domain name (an IP address fails at startup), the origin's host or a parent of it. |
| `WEBAUTHN_ORIGIN` | origin of `PUBLIC_BASE_URL` | Origin WebAuthn ceremonies run on. |
| `WEBAUTHN_RP_NAME` | `Happy Enterprise` | Name shown by authenticators. |

Security keys and passkeys are bound to the relying party id. Changing it
later makes existing WebAuthn factors unusable.

## Email

| Variable | Default | Meaning |
|---|---|---|
| `EMAIL_PROVIDER` | `log` | `log` (development only: logs messages, including login codes), `resend`, `ses`, `smtp`, `webhook`. |
| `EMAIL_FROM` | required unless `log` | Sender address. |
| `RESEND_API_KEY` | required for `resend` | Resend API key. |
| `RESEND_API_URL` | `https://api.resend.com` | Resend API base; `/emails` is appended. |
| `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | required for `ses` | Amazon SES v2 `SendEmail`, signed with SigV4. |
| `SES_SESSION_TOKEN`, `SES_ENDPOINT` | none | Temporary credentials; a custom endpoint. |
| `SMTP_URL` | required for `smtp` | e.g. `smtps://user:pass@smtp.example.com` or `smtp://host:587?tls=required`. |
| `EMAIL_WEBHOOK_URL` | required for `webhook` | Receives a `POST` of `{from, to, subject, text, html}`. |
| `EMAIL_WEBHOOK_SECRET` | none | Signs webhook requests (see [Files and email](/docs/concepts/files-and-email/)). |

## Storage

| Variable | Default | Meaning |
|---|---|---|
| `STORAGE_BACKEND` | `local` | `local` or `s3`. |
| `STORAGE_LOCAL_DIR` | `data/files` | Root directory of the local store. |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | required for `s3` | S3 (or compatible) bucket. |
| `S3_ENDPOINT`, `S3_PREFIX`, `S3_SESSION_TOKEN` | none | Custom endpoint (path-style, e.g. MinIO, R2), key prefix, temporary credentials. |

## Actions

| Variable | Default | Meaning |
|---|---|---|
| `ACTION_WEBHOOKS_ALLOW_PRIVATE` | `false` | `true` lets [action](/docs/concepts/actions/) webhooks use `http` and reach private and loopback addresses. Development only. |

## Connectors

| Variable | Default | Meaning |
|---|---|---|
| `CONNECTORS_ALLOW_HTTP` | `false` | `true` lets [connectors](/docs/concepts/connectors/#network-safety) and their OAuth servers use `http`. Development only. |
| `CONNECTORS_ALLOW_ADDRESSES` | none | Comma-separated CIDRs (`10.0.0.0/8`, `192.168.1.5`) and host names that connectors may reach although they are not public, such as an MCP server on your internal network. Everything else that is loopback, private, link-local (cloud metadata included), shared, or reserved is refused. |

## Validators and logging

| Variable | Default | Meaning |
|---|---|---|
| `MONTY_WORKER` | `happy-enterprise-monty-worker` next to the server binary, if present | Sandbox worker for custom validators; `off` disables them (writes that need them get `503`). |
| `RUST_LOG` | `info` | `tracing` filter, e.g. `warn,happy_enterprise=debug`. |

## A production example

```sh
ORG_DATABASE_URL=postgres://happy_enterprise_org:...@db.internal/happy_enterprise
MANAGEMENT_DATABASE_URL=postgres://happy_enterprise_management:...@db.internal/happy_enterprise
RUN_MIGRATIONS=false
PUBLIC_BASE_URL=https://api.acme.example
CLIENT_IP_HEADER=x-real-ip
SERVER_SECRET_KEY=...
MANAGEMENT_JWT_PUBLIC_KEYS=ops-2026=11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo
EMAIL_PROVIDER=ses
EMAIL_FROM="Acme <no-reply@acme.example>"
SES_REGION=eu-west-1
SES_ACCESS_KEY_ID=...
SES_SECRET_ACCESS_KEY=...
STORAGE_BACKEND=s3
S3_BUCKET=acme-happy-enterprise
S3_REGION=eu-west-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```
