---
layout: ../../../layouts/Docs.astro
title: Management API
lead: Create organizations and register the keys of their identity providers, on a separate listener with its own credentials and database role. Callers are provisioning scripts with JWTs, or operators who sign in with a password or a security key.
---

The management API is for the operator, not for organizations. It listens on
`MANAGEMENT_LISTEN_ADDR` (default `127.0.0.1:9090`), shares no routes with the
organization API, and connects to Postgres as `happy_enterprise_management`, a
role with grants on the list of organizations and their identity provider
keys, and none on organization data. Keep it off the public network.
`MANAGEMENT_MOUNT` (`/mgmt` in the [Docker image](/docs/self-hosting/docker/))
also serves it under that path on the organization listener, for the
operator console: `POST /mgmt/v1/setup` there is `POST /v1/setup` here.

It never creates users or teams: an organization's system teams and first
owner come into being when its `owner_email` first logs in, with an email
code or an [owner link](#post-v1-organizations-id-owner-link).

## Authentication

Every route except `/health`, setup, sign-in, and enrollment needs a
bearer token, of a kind that `MANAGEMENT_AUTH` allows:

- **a management JWT**, with `jwt` (the default), described below;
- **an operator session** `hems_...`, with `webauthn` or `password`, opened
  by [signing in](/docs/self-hosting/operators/) with a security key or a
  password.

"any" below means either. Organization API credentials (`heat_`, `hemt_`,
session tokens) are refused here, and operator sessions by the organization
API.

### Management JWTs

An EdDSA (Ed25519) token:

| | |
|---|---|
| header `kid` | one of the keys in `MANAGEMENT_JWT_PUBLIC_KEYS` (`kid=<base64url raw key>,...`) |
| `aud` | `"happy-enterprise:management"`, a single string (an array is refused) |
| `iss` | `MANAGEMENT_JWT_ISSUER`, default `happy-enterprise-management` |
| `sub` | who is calling; logged with every change |
| `exp` | required; `nbf` is checked if present; 30 s leeway |

Organization API tokens are refused here, and management tokens by the
organization API: the audiences differ, and a token naming both is refused everywhere. Every failure
is the same `401 unauthorized`.

Minting a token with Python and `cryptography`:

```python
import base64, json, time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
key = Ed25519PrivateKey.generate()
pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
header = b64(json.dumps({"alg": "EdDSA", "typ": "JWT", "kid": "ops"}).encode())
claims = b64(json.dumps({"sub": "ops@example.com", "aud": "happy-enterprise:management",
    "iss": "happy-enterprise-management", "exp": int(time.time()) + 3600}).encode())
sig = key.sign(f"{header}.{claims}".encode())
print("MANAGEMENT_JWT_PUBLIC_KEYS=ops=" + b64(pub))
print(f"{header}.{claims}.{b64(sig)}")
```

Keep the private key wherever your operators sign tokens; the server only
holds public keys.

### Step-up

Creating organizations and owner links, registering and revoking
organizations' signing keys, and every change to operators, their keys and
passwords need a fresh confirmation within the last `MANAGEMENT_STEP_UP_WINDOW`
(5 minutes), at sign-in or with a step-up. An operator with a usable
security key confirms with a touch of their own key; an operator with only
a password, by entering it again. Otherwise they are:

```json
403 { "error": { "code": "step_up_required",
      "message": "verify again (POST /v1/auth/step-up/start with a security key, or /v1/auth/step-up/password) to do this" } }
```

JWT callers are not asked to step up.

### Before setup

With `password` in `MANAGEMENT_AUTH`, until an enabled operator has a
password, every route except `/health`, `/v1/setup` and `/v1/auth/methods`
answers, here and on the organization API alike:

```json
503 { "error": { "code": "setup_required",
      "message": "set the admin password first (management API POST /v1/setup)" } }
```

## Health

### GET /health

<p class="ep-meta"><span><b>Auth</b>none</span></p>

```json
{ "status": "ok" }
```

## First-run setup

See [First run](/docs/self-hosting/operators/#first-run).

### GET /v1/setup

<p class="ep-meta"><span><b>Auth</b>none</span></p>

`{"required": true}` until the admin exists.

### POST /v1/setup

<p class="ep-meta"><span><b>Auth</b>setup code</span><span><b>Rate limit</b>30 / 10 min per IP</span></p>

```json
{ "code": "7KQM-2XHD-9WPT", "username": "admin", "password": "a long admin password", "name": "Sam Rivera" }
```

The code is the one the server logged at startup. `username` is 1 to 64
characters of `a-z0-9._-`, starting with a letter or digit; `password` is
12 to 256 characters; `name` defaults to the username. `201` with a
session, as [password sign-in](#post-v1-auth-password) returns. `401` for
a wrong code, `409` once setup is done.

## Organizations

An organization:

```json
{
  "id": "c8kq2m7xw3n5p9r1t4v6y0za",
  "name": "Acme",
  "slug": "acme",
  "bootstrap_owner_email": "ada@acme.example",
  "require_2fa": false,
  "created_at": "2026-10-24T10:00:00Z"
}
```

### GET /v1/organizations

<p class="ep-meta"><span><b>Auth</b>any</span></p>

Every organization, oldest first, as a JSON array.

### POST /v1/organizations

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

```sh
curl -X POST http://127.0.0.1:9090/v1/organizations \
  -H "Authorization: Bearer $MGMT_JWT" -H "Content-Type: application/json" \
  -d '{"name": "Acme", "owner_email": "ada@acme.example", "slug": "acme"}'
```

`201` with the organization. `slug` is its
[address](/docs/concepts/organizations/#the-organizations-address), set for
good; without one it is derived from the name. `409 slug_taken`,
`422 slug_reserved`, `422 slug_invalid`. `name` is 1-200 characters after trimming;
`owner_email` must be a valid address and is stored normalized. That address
may log in while the organization has no active owner and becomes its first
owner (see [Joining](/docs/concepts/authentication/)).

### GET /v1/organizations/{id}

<p class="ep-meta"><span><b>Auth</b>any</span></p>

The organization, or `404`.

### POST /v1/organizations/{id}/owner-link

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

A single-use [set-password link](/docs/self-hosting/operators/#owner-links)
for an owner, valid for 24 hours. `email` is optional and defaults to the
organization's `bootstrap_owner_email`.

```json
{ "email": "ada@acme.example" }
```

`201`:

```json
{ "url": "https://api.acme.example/reset-password?org=c8kq2m7xw3n5p9r1t4v6y0za#token=...",
  "token": "...", "email": "ada@acme.example", "expires_at": "2026-10-29T10:00:00Z" }
```

The owner redeems it with
[`POST /v1/orgs/{org}/auth/password/reset`](/docs/api/auth/#post-v1-orgs-org-auth-password-reset).
While the organization has no owner, it makes the bootstrap address its
first owner; otherwise it resets the password of the owner with that
address. `400` without `ORG_PASSWORD_AUTH`, `404` for an unknown
organization. The audit log records the organization and the address.

## Signing keys

An organization's own identity provider can sign
[external JWTs](/docs/concepts/authentication/) for its users. Register its
public keys here. A key works only for the organization it is registered to:
the signed `oid` claim (the organization ID) must equal the key's owner.

```json
{
  "kid": "acme-idp-2026",
  "public_key": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  "created_at": "2026-10-24T10:00:00Z",
  "revoked_at": null
}
```

`public_key` is the raw 32-byte Ed25519 public key, base64url without
padding (a JWK's `x`).

### GET /v1/organizations/{id}/keys

<p class="ep-meta"><span><b>Auth</b>any</span></p>

The organization's keys, revoked ones included, oldest first.

### POST /v1/organizations/{id}/keys

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

```json
{ "kid": "acme-idp-2026", "public_key": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" }
```

`201` with the key. `kid` is 1-128 characters of `[A-Za-z0-9._-]` and must
not start with `he-` (reserved for the server's own session keys). `400` for
a bad `kid` or key, `404` for an unknown organization, `409` if the organization
already has a key with that `kid`.

### DELETE /v1/organizations/{id}/keys/{kid}

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

Revokes the key. `204`; `404` if the organization has no active key with that
`kid`. Tokens signed with it stop working on their next request. A revoked
`kid` stays taken.

## Operator sign-in

The security-key routes exist only when `MANAGEMENT_AUTH` includes
`webauthn`, the password routes only with `password`, and the operator
routes with either. `GET /v1/auth/methods`, `GET /v1/auth/me` and
`GET /v1/audit` always exist. `options`
are WebAuthn options as JSON (`PublicKeyCredentialRequestOptions` or
`PublicKeyCredentialCreationOptions`), and `credential` is the browser's
answer, as JSON. Setup, sign-in, step-up and enrollment requests are
[rate limited](/docs/concepts/rate-limits/), and failed passwords
[back off](/docs/concepts/authentication/#failed-attempts).

### GET /v1/auth/methods

<p class="ep-meta"><span><b>Auth</b>none</span></p>

```json
{ "jwt": false,
  "webauthn": { "rp_id": "ops.example.com", "attestation_required": true, "session_ttl_seconds": 900,
                "idle_timeout_seconds": 300, "step_up_window_seconds": 300 },
  "password": true, "setup_required": false,
  "session_ttl_seconds": 900, "idle_timeout_seconds": 300, "step_up_window_seconds": 300 }
```

`webauthn` is `null` without security keys, `password` is `false` without
passwords, and `setup_required` is `true` until the
[admin exists](#first-run-setup).

### POST /v1/auth/password

<p class="ep-meta"><span><b>Auth</b>none</span></p>

```json
{ "username": "admin", "password": "a long admin password" }
```

`200` with a session, as for a key below, with `session.method` set to
`"password"` and no `credential_id`. Every failure is the same `401`;
`429` with `Retry-After` while this client is locked out for this
username.

### POST /v1/auth/sign-in/start

<p class="ep-meta"><span><b>Auth</b>none</span></p>

`{"ceremony_id": "...", "options": {...}}`: a challenge for any enrolled key.

### POST /v1/auth/sign-in/finish

<p class="ep-meta"><span><b>Auth</b>none</span></p>

```json
{ "ceremony_id": "...", "credential": { ... } }
```

The assertion must come from an enrolled key of an enabled operator, with
user verification and presence; `401` otherwise. Returns:

```json
{ "token": "hems_...",
  "operator": { "id": "o1p2e3r4a5t6o7r8q9w0e1r2", "name": "Sam Rivera" },
  "session": { "id": "...", "credential_id": "...", "expires_at": "2026-10-28T09:15:00Z",
               "verified_at": "2026-10-28T09:00:00Z", "step_up_fresh": true,
               "step_up_until": "2026-10-28T09:05:00Z", "idle_timeout_seconds": 300 } }
```

Send `token` as `Authorization: Bearer hems_...`.

### POST /v1/auth/step-up/start, POST /v1/auth/step-up/finish

<p class="ep-meta"><span><b>Auth</b>operator session</span></p>

As sign-in, with the session operator's own keys. `finish` returns
`{"session": {...}}`, fresh for `MANAGEMENT_STEP_UP_WINDOW`. `400` for JWT
callers.

### POST /v1/auth/step-up/password

<p class="ep-meta"><span><b>Auth</b>operator session</span></p>

```json
{ "password": "a long admin password" }
```

`{"session": {...}}`, fresh for `MANAGEMENT_STEP_UP_WINDOW`. A wrong
password is `401` and backs off like sign-in. An operator with a usable
security key steps up only with the key:

```json
403 { "error": { "code": "use_security_key", ... } }
```

### POST /v1/auth/sign-out

<p class="ep-meta"><span><b>Auth</b>operator session</span></p>

Ends the session. `204`.

### GET /v1/auth/me

<p class="ep-meta"><span><b>Auth</b>any</span></p>

`{"method": "jwt", "subject": "..."}`, or `{"method": "webauthn",
"operator": {...}, "session": {...}}` with the session as above, where
`method` is `"webauthn"` or `"password"` after how the session was opened.

## Enrollment

An enrollment link carries a single-use token, valid for 15 minutes. The
page it opens runs these two requests.

### POST /v1/enroll/start

<p class="ep-meta"><span><b>Auth</b>link token</span></p>

```json
{ "token": "<from the link>", "name": "YubiKey 5C, blue" }
```

`name` names the key (default "Security key"). Returns `{ceremony_id,
options, operator}`.

### POST /v1/enroll/finish

<p class="ep-meta"><span><b>Auth</b>link token</span></p>

```json
{ "token": "<from the link>", "ceremony_id": "...", "credential": { ... } }
```

`201` with `{operator, credential: {id, name, aaguid}}`. With an
[attestation allowlist](/docs/self-hosting/operators/#requiring-yubikeys),
`403 key_not_allowed` for a key that is not attested by a configured root,
not on the list, or can be synced. A successful enrollment uses the link
up; each attempt needs a new `start`.

## Operators

### GET /v1/operators

<p class="ep-meta"><span><b>Auth</b>any</span></p>

Every operator, with `username`, `has_password`, `disabled_at`, and their
keys: `id`, `name`, `aaguid` (verified, under an allowlist), `created_at`,
`last_used_at`.

### POST /v1/operators

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

```json
{ "name": "Sam Rivera", "username": "sam", "password": "a long password to pass on" }
```

`201` with `{operator, enrollment: {operator_id, url, token, expires_at}}`:
open `url` with the new operator's key within 15 minutes. `enrollment` is
`null` without `webauthn`. `name` is 1-200 characters. `username` and
`password` need `password` in `MANAGEMENT_AUTH`, and a password needs a
username; `409` if the username is taken.

### PUT /v1/operators/{id}/password

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

```json
{ "password": "a long new password", "username": "sam" }
```

Sets the operator's password, and returns the operator. `username` is
needed only if the operator has none yet. The operator's other password
sessions end. `400` for a short password or a missing username, `404` for
an unknown operator, `409` if the username is taken.

### DELETE /v1/operators/{id}/password

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

Removes the operator's password and ends its password sessions. `204`;
`409` if it is the last active credential.

### POST /v1/operators/{id}/enrollments

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

A link for another key of the operator: `201` with `{operator_id, url,
token, expires_at}`.

### POST /v1/operators/{id}/disable, POST /v1/operators/{id}/enable

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

Returns the operator. Disabling ends its sessions at once.

### DELETE /v1/operators/{id}, DELETE /v1/operators/{id}/credentials/{key}

<p class="ep-meta"><span><b>Auth</b>any, with step-up</span></p>

Removes an operator, or one key. `204`. `409` if it would remove the last
active credential, a key or password of an enabled operator, also when
disabling. A key's sessions end with it.

## Audit log

### GET /v1/audit

<p class="ep-meta"><span><b>Auth</b>any</span></p>

Every management request but `/health`, newest first:
`{"entries": [...], "next_before": ...}`, with `before` (an entry id) and
`limit` (1-500, default 100).

```json
{ "id": 4182, "at": "2026-10-28T09:01:12Z", "action": "POST /v1/organizations", "status": 201,
  "operator_id": "o1p2e3r4a5t6o7r8q9w0e1r2", "credential_id": "...", "session_id": "...",
  "jwt_subject": null, "client_ip": "203.0.113.7",
  "detail": { "path": "/v1/organizations", "step_up_credential_id": "..." } }
```

`action` is the method and route template. `detail` holds the concrete
`path`, the `reason` a request failed, the `target_operator_id` or
`target_credential_id` it changed, and the `step_up_credential_id`.
Enrollments made from the command line are recorded too.

