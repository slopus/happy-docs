---
layout: ../../layouts/Docs.astro
title: Quickstart
lead: Run the server locally, create an organization, sign in as its first owner, and store your first objects. About ten minutes.
---

You need:

- the `happy-enterprise` server binary, and `happy-enterprise-monty-worker`
  next to it if you want [custom validators](/docs/concepts/validators/),
- Postgres 16 or newer, with a user that may create databases and roles
  (the default `postgres` superuser is fine locally),
- `curl`, `jq`, and Python 3 with `cryptography` to mint a management token.

## 1. Prepare the database

Create a database and the two roles the server runs as. The server creates
the roles itself if they are missing, but without passwords; creating them
first lets them log in over TCP.

```sh
psql -U postgres <<'SQL'
CREATE DATABASE happy_enterprise;
CREATE ROLE happy_enterprise_tenant LOGIN NOINHERIT PASSWORD 'dev-only-1';
CREATE ROLE happy_enterprise_management LOGIN NOINHERIT PASSWORD 'dev-only-2';
SQL

export DATABASE_URL=postgres://postgres@localhost/happy_enterprise
export TENANT_DATABASE_URL=postgres://happy_enterprise_tenant:dev-only-1@localhost/happy_enterprise
export MANAGEMENT_DATABASE_URL=postgres://happy_enterprise_management:dev-only-2@localhost/happy_enterprise
```

On startup the server applies its migrations as `DATABASE_URL`'s user, then
connects as the two runtime roles. It refuses to start if either runtime role
is a superuser or may bypass row level security. Add a password to
`DATABASE_URL` if your Postgres asks for one.

## 2. Configure

Generate the server secret and a management key pair. The secret derives
session signing keys and seals TOTP secrets; the management key signs the
operator's tokens.

```sh
export SERVER_SECRET_KEY="$(openssl rand 32 | basenc --base64url | tr -d =)"

read -r MGMT_PUB MGMT_JWT < <(python3 - <<'EOF'
import base64, json, time
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
key = Ed25519PrivateKey.generate()
pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
header = b64(json.dumps({"alg": "EdDSA", "typ": "JWT", "kid": "ops"}).encode())
claims = b64(json.dumps({"sub": "me@example.com", "aud": "happy-enterprise:management",
    "iss": "happy-enterprise-management", "exp": int(time.time()) + 3600}).encode())
print(b64(pub), f"{header}.{claims}.{b64(key.sign(f'{header}.{claims}'.encode()))}")
EOF
)
export MANAGEMENT_JWT_PUBLIC_KEYS="ops=$MGMT_PUB"
export EMAIL_PROVIDER=log   # the default: emails, login codes included, go to the log
```

## 3. Run

```sh
./happy-enterprise
```

```text
INFO migrations applied
INFO tenant API listening addr=0.0.0.0:8080
INFO management API listening addr=127.0.0.1:9090
```

The organization API is on `:8080`, the management API on `127.0.0.1:9090`. Run
the remaining steps in a second shell with the same `MGMT_JWT`.

## 4. Create an organization

```sh
ORG=$(curl -s -X POST http://127.0.0.1:9090/v1/tenants \
  -H "Authorization: Bearer $MGMT_JWT" -H "Content-Type: application/json" \
  -d '{"name": "Acme", "owner_email": "ada@acme.example"}' | jq -r .id)
echo "$ORG"
```

The organization exists, but has no users yet. Its system teams and first
owner are created when `ada@acme.example` logs in.

## 5. Sign in as the owner

```sh
BASE=http://localhost:8080
CHALLENGE=$(curl -s -X POST "$BASE/v1/orgs/$ORG/auth/email/start" \
  -H "Content-Type: application/json" -d '{"email": "ada@acme.example"}' | jq -r .challenge_id)
```

The `log` provider writes the email to the server's output:

```text
INFO email (log provider) to=ada@acme.example subject=Your Acme sign-in code: 482913 ...
```

```sh
TOKEN=$(curl -s -X POST "$BASE/v1/orgs/$ORG/auth/email/verify" \
  -H "Content-Type: application/json" \
  -d "{\"challenge_id\": \"$CHALLENGE\", \"code\": \"482913\"}" | jq -r .token)

curl -s "$BASE/v1/me" -H "Authorization: Bearer $TOKEN" | jq '{user: .user.display_name, permissions}'
```

The token is a session token valid for 30 days, until you log out.

## 6. Define an object type

```sh
curl -s -X POST "$BASE/v1/ontology/object-types" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "api_name": "employee",
    "display_name": "Employee",
    "properties": [
      { "api_name": "name",    "type": { "kind": "string" }, "required": true },
      { "api_name": "email",   "type": { "kind": "string" },
        "rules": [{ "rule": "email" }, { "rule": "unique" }] },
      { "api_name": "team",    "type": { "kind": "string" } },
      { "api_name": "started", "type": { "kind": "date" } }
    ]
  }'
```

## 7. Write and query objects

```sh
curl -s -X POST "$BASE/v1/ontology/objects/employee" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"properties": {"name": "Grace", "email": "grace@acme.example", "team": "platform", "started": "2026-03-01"}}'

curl -s -X POST "$BASE/v1/ontology/objects/employee" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"properties": {"name": "Linus", "email": "not-an-email"}}'
# 422 validation_failed: email "must be an email address"
```

```sh
curl -s -X POST "$BASE/v1/ontology/objects/employee/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"filter": {"op": "eq", "property": "team", "value": "platform"},
       "order_by": {"property": "started", "direction": "desc"}}'
```

In another shell, watch changes as they happen:

```sh
curl -N "$BASE/v1/ontology/events" -H "Authorization: Bearer $TOKEN"
```

## Next

* [Organizations and isolation](/docs/concepts/isolation/): how one organization
  is kept from seeing another.
* [The ontology](/docs/concepts/ontology/): property types, format rules,
  links, and queries.
* [MCP and OAuth](/docs/concepts/mcp/): connect an AI client to your
  organization.
* [Self-hosting](/docs/self-hosting/): deploy it for real.
