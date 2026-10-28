---
layout: ../../layouts/Docs.astro
title: Quickstart
lead: Start the Docker image, set the admin password, create an organization, sign in as its first owner, store your first objects, and open them in the web app. About ten minutes.
---

You need Docker, `curl`, and `jq`, and the source distribution to build
the image from. To run the binaries without Docker, see
[Deploying](/docs/self-hosting/).

## 1. Start it

```sh
docker build -t happy-enterprise .
docker run -d --name happy -p 8080:8080 -v ./data:/data happy-enterprise
```

The container runs the server, the web app and its own Postgres, and keeps
everything in `./data`. The organization API and the web app are on
`http://localhost:8080`, the management API under
`http://localhost:8080/mgmt`. See [Docker](/docs/self-hosting/docker/) for
what it sets up.

## 2. Set the admin password

Until the first operator, the admin, has a password, the server answers
nothing but setup. It logs a one-time setup code:

```sh
docker logs happy 2>&1 | grep 'setup code'
```

```text
WARN first run: open the console and set the admin password with setup code 7KQM-2XHD-9WPT (or set ADMIN_PASSWORD)
```

```sh
BASE=http://localhost:8080
ADMIN=$(curl -s -X POST "$BASE/mgmt/v1/setup" -H "Content-Type: application/json" \
  -d '{"code": "7KQM-2XHD-9WPT", "username": "admin", "password": "a long admin password"}' | jq -r .token)
```

`ADMIN` is an operator session. It lasts 15 minutes (5 without a request),
and creating organizations needs a sign-in within the last 5. When it runs
out, sign in again:

```sh
ADMIN=$(curl -s -X POST "$BASE/mgmt/v1/auth/password" -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "a long admin password"}' | jq -r .token)
```

## 3. Create an organization

```sh
ORG=$(curl -s -X POST "$BASE/mgmt/v1/organizations" \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"name": "Acme", "owner_email": "ada@acme.example"}' | jq -r .id)
echo "$ORG"
```

The organization exists, but has no users yet. Its system teams and first
owner are created when `ada@acme.example` first signs in.

## 4. Sign in as the owner

Make an owner link: a single-use link that sets the owner's password.

```sh
LINK=$(curl -s -X POST "$BASE/mgmt/v1/organizations/$ORG/owner-link" -H "Authorization: Bearer $ADMIN")
echo "$LINK" | jq -r .url
# http://localhost:8080/reset-password?org=c8kq2m7xw3n5p9r1t4v6y0za#token=...
```

In a real deployment you would send `url` to the owner. Here, redeem it
yourself, then sign in with the password:

```sh
curl -s -X POST "$BASE/v1/orgs/$ORG/auth/password/reset" -H "Content-Type: application/json" \
  -d "$(jq -nc --arg token "$(echo "$LINK" | jq -r .token)" '{token: $token, password: "a long owner password"}')"

TOKEN=$(curl -s -X POST "$BASE/v1/orgs/$ORG/auth/password" -H "Content-Type: application/json" \
  -d '{"email": "ada@acme.example", "password": "a long owner password"}' | jq -r .token)

curl -s "$BASE/v1/me" -H "Authorization: Bearer $TOKEN" | jq '{user: .user.display_name, permissions}'
```

The token is a session token valid for 30 days, until you log out. The
address is only a login name here: no email was sent.

## 5. Define an object type

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

## 6. Write and query objects

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

## 7. Open the web app

Open `http://localhost:8080`, enter the organization's id (`echo $ORG`) and
`ada@acme.example`, choose **Password**, and sign in with the owner's
password. The `employee` type and its objects are under **Objects**, its
definition under **Ontology**, and changes made through `curl` appear in
**Live** as they commit.

The operator console is at `http://localhost:8080/console`; sign in there
with the admin's username and password. Steps 2 to 4 can all be done in
the browser instead: the console's setup screen, its organization page with
the **Owner link** button, and the web app's set-password page. See
[Docker](/docs/self-hosting/docker/#first-run).

## Next

* [Web app](/docs/web-app/): every screen, and what it can and cannot see.
* [Organizations and isolation](/docs/concepts/isolation/): how one organization
  is kept from seeing another.
* [The ontology](/docs/concepts/ontology/): property types, format rules,
  links, and queries.
* [MCP and OAuth](/docs/concepts/mcp/): connect an AI client to your
  organization.
* [Docker](/docs/self-hosting/docker/): a reverse proxy, email, backups, and
  upgrades, to run it for real.
