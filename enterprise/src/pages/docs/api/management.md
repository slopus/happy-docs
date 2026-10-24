---
layout: ../../../layouts/Docs.astro
title: Management API
lead: Create organisations and register the keys of their identity providers, on a separate listener with its own credentials and database role.
---

The management API is for the operator, not for tenants. It listens on
`MANAGEMENT_LISTEN_ADDR` (default `127.0.0.1:9090`), shares no routes with the
tenant API, and connects to Postgres as `happy_enterprise_management`, a role
with grants on the control-plane tables (`tenants`, `tenant_signing_keys`)
and none on organisation data. Keep it off the public network.

It never creates users or teams: an organisation's system teams and first
owner come into being when its `owner_email` first logs in.

## Authentication

Every route except `/health` needs `Authorization: Bearer <JWT>`, an EdDSA
(Ed25519) token:

| | |
|---|---|
| header `kid` | one of the keys in `MANAGEMENT_JWT_PUBLIC_KEYS` (`kid=<base64url raw key>,...`) |
| `aud` | `"happy-enterprise:management"`, a single string (an array is refused) |
| `iss` | `MANAGEMENT_JWT_ISSUER`, default `happy-enterprise-management` |
| `sub` | who is calling; logged with every change |
| `exp` | required; `nbf` is checked if present; 30 s leeway |

Tenant tokens are refused here, and management tokens by the tenant API: the
audiences differ, and a token naming both is refused everywhere. Every failure
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

## Health

### GET /health

<p class="ep-meta"><span><b>Auth</b>none</span></p>

```json
{ "status": "ok" }
```

## Tenants

A tenant is an organisation:

```json
{
  "id": "c8kq2m7xw3n5p9r1t4v6y0za",
  "name": "Acme",
  "bootstrap_owner_email": "ada@acme.example",
  "require_2fa": false,
  "created_at": "2026-10-24T10:00:00Z"
}
```

### GET /v1/tenants

<p class="ep-meta"><span><b>Auth</b>management JWT</span></p>

Every tenant, oldest first, as a JSON array.

### POST /v1/tenants

<p class="ep-meta"><span><b>Auth</b>management JWT</span></p>

```sh
curl -X POST http://127.0.0.1:9090/v1/tenants \
  -H "Authorization: Bearer $MGMT_JWT" -H "Content-Type: application/json" \
  -d '{"name": "Acme", "owner_email": "ada@acme.example"}'
```

`201` with the tenant. `name` is 1-200 characters after trimming;
`owner_email` must be a valid address and is stored normalised. That address
may log in while the organisation has no active owner and becomes its first
owner (see [Joining](/docs/concepts/authentication/)).

### GET /v1/tenants/{tenant_id}

<p class="ep-meta"><span><b>Auth</b>management JWT</span></p>

The tenant, or `404`.

## Signing keys

An organisation's own identity provider can sign
[external JWTs](/docs/concepts/authentication/) for its users. Register its
public keys here. A key works only for the tenant it is registered to: the
signed `tid` must equal the key's owner.

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

### GET /v1/tenants/{tenant_id}/keys

<p class="ep-meta"><span><b>Auth</b>management JWT</span></p>

The tenant's keys, revoked ones included, oldest first.

### POST /v1/tenants/{tenant_id}/keys

<p class="ep-meta"><span><b>Auth</b>management JWT</span></p>

```json
{ "kid": "acme-idp-2026", "public_key": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" }
```

`201` with the key. `kid` is 1-128 characters of `[A-Za-z0-9._-]` and must
not start with `he-` (reserved for the server's own session keys). `400` for
a bad `kid` or key, `404` for an unknown tenant, `409` if the tenant already
has a key with that `kid`.

### DELETE /v1/tenants/{tenant_id}/keys/{kid}

<p class="ep-meta"><span><b>Auth</b>management JWT</span></p>

Revokes the key. `204`; `404` if the tenant has no active key with that
`kid`. Tokens signed with it stop working on their next request. A revoked
`kid` stays taken.
