---
layout: ../../../layouts/Docs.astro
title: Docker
lead: One image runs everything, the server, the web app and Postgres, and keeps all its state in one directory. Start it, set the admin password, create an organization, and hand its owner a link.
---

The image holds the server, the sandbox worker for
[custom validators](/docs/concepts/validators/), the built web app, and an
embedded Postgres 18. Everything it stores lives in `/data`. The image is not
published to a registry: build it from the source distribution.

```sh
docker build -t happy-enterprise .
docker run -d --name happy -p 8080:8080 -v ./data:/data happy-enterprise
```

The web app is at `http://localhost:8080`, the organization API next to it,
and the management API under `http://localhost:8080/mgmt`.

## With Compose

Compose reads its settings from `.env`. `.env.example` lists every variable
the container takes, each with the image default:

```sh
cp .env.example .env    # set PUBLIC_BASE_URL at least
docker compose up -d    # host port 80 by default (HTTP_PORT)
```

## What the container does

The entrypoint runs under `tini`. As root it only fixes the ownership of
`/data`, then drops to the user `happy` (uid 10001). On the first start it:

1. creates the Postgres cluster in `/data/pg`, listening on a unix socket
   only (`/data/run`), never on TCP;
2. generates the Postgres superuser password, the passwords of the two
   runtime roles, and `SERVER_SECRET_KEY` into `/data/secrets` (directory
   `700`, files `600`);
3. creates the database and the roles, and starts the server, which runs the
   migrations.

Later starts reuse all of it. On `docker stop` the server finishes its
requests, then Postgres shuts down cleanly. If Postgres dies, the server is
stopped too and the container exits, so the restart policy brings both back.

The image sets these defaults. A variable you set always wins.

| Variable | Image default |
|---|---|
| `PUBLIC_BASE_URL` | `http://localhost:8080` |
| `EMAIL_PROVIDER` | `log` |
| `ORG_PASSWORD_AUTH` | `true` |
| `MANAGEMENT_AUTH` | `password,webauthn` |
| `MANAGEMENT_MOUNT` | `/mgmt` (`off`: the management API only on `MANAGEMENT_LISTEN_ADDR`) |
| `MANAGEMENT_WEBAUTHN_RP_ID`, `MANAGEMENT_WEBAUTHN_ORIGIN` | host and origin of `PUBLIC_BASE_URL` |
| `WEB_DIR` | `/app/web` |
| `STORAGE_LOCAL_DIR` | `/data/files` |
| `SERVER_SECRET_KEY` | generated into `/data/secrets/server_secret_key` |
| `DATABASE_URL`, `ORG_DATABASE_URL`, `MANAGEMENT_DATABASE_URL` | the embedded Postgres |

Everything else is as in [Configuration](/docs/self-hosting/configuration/).

## First run

Until the first [operator](/docs/self-hosting/operators/), the admin, has a
password, the server answers `503 setup_required` to everything except the
web app, `/health`, and setup. There are two ways to create the admin.

**The setup code.** The server logs a one-time code at startup:

```sh
docker logs happy 2>&1 | grep 'setup code'
```

```text
WARN first run: open the console and set the admin password with setup code 7KQM-2XHD-9WPT (or set ADMIN_PASSWORD)
```

Open the console, `http://localhost:8080/console`. On a new server it shows
the setup screen: enter the code, the admin's username, and a password
twice, and you are signed in as the admin.

The code belongs to the process: it changes on every restart until setup is
done. With several replicas, each logs its own; use `ADMIN_PASSWORD`, or the
code from the log of the replica you reach.

**`ADMIN_PASSWORD`.** Set it (and `ADMIN_USERNAME`, default `admin`) in
`.env`, and the admin is created at startup with no setup step. It is read
only while no operator has a password; remove it from `.env` afterwards.

## The first organization

In the console, the admin:

1. creates an organization with its name and its owner's email address;
2. on the organization's page, presses **Owner link** (leaving the address
   empty means the bootstrap owner's) and copies the link;
3. sends it to the owner, over a channel they trust.

The link opens `/reset-password` in the web app. It works once, within 24
hours. The owner chooses a password there, which makes them the
organization's first owner, and then signs in on the sign-in page with
**Password**. From there the owner runs the organization: invites, whose
links the web app shows to copy while email goes to the log, teams,
two-factor policy, and the rest of the [web app](/docs/web-app/).

See [Passwords](/docs/concepts/authentication/#signing-in-with-a-password)
for how organization passwords work.

### With the API instead

```sh
BASE=http://localhost:8080
ADMIN=$(curl -s -X POST "$BASE/mgmt/v1/setup" -H "Content-Type: application/json" \
  -d '{"code": "7KQM-2XHD-9WPT", "username": "admin", "password": "a long admin password"}' | jq -r .token)

ORG=$(curl -s -X POST "$BASE/mgmt/v1/organizations" \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"name": "Acme", "owner_email": "ada@acme.example"}' | jq -r .id)

curl -s -X POST "$BASE/mgmt/v1/organizations/$ORG/owner-link" -H "Authorization: Bearer $ADMIN"
```

```json
{ "url": "http://localhost:8080/reset-password?org=c8kq2m7xw3n5p9r1t4v6y0za#token=...",
  "token": "...", "email": "ada@acme.example", "expires_at": "2026-10-29T10:00:00Z" }
```

```sh
curl -s -X POST "$BASE/v1/orgs/$ORG/auth/password/reset" -H "Content-Type: application/json" \
  -d '{"token": "<token from the link>", "password": "a long owner password"}'

TOKEN=$(curl -s -X POST "$BASE/v1/orgs/$ORG/auth/password" -H "Content-Type: application/json" \
  -d '{"email": "ada@acme.example", "password": "a long owner password"}' | jq -r .token)
```

The [Quickstart](/docs/quickstart/) continues from here.

## Email

`EMAIL_PROVIDER=log` writes emails to the container log. That is fine while
everyone uses passwords: invite and set-password links are returned to
whoever makes them. But sign-in codes end up in the log too, so for real
users configure a provider (`resend`, `ses`, `cloudflare`, `smtp`, or
`webhook`) and `EMAIL_FROM`, as in
[Configuration](/docs/self-hosting/configuration/#email).

## Behind a reverse proxy

Terminate TLS in a proxy in front of port 8080, and set `PUBLIC_BASE_URL`
to the `https://` address people open: links, OAuth issuers and the
operator keys' relying party derive from it.

Rate limits and password lockouts key on the client IP. Behind a proxy, set
`CLIENT_IP_HEADER` to the header that carries it, but only if the proxy
overwrites that header; otherwise clients choose their own address.

* `CLIENT_IP_HEADER=x-real-ip`, with a proxy that sets `X-Real-IP` to the
  client address.
* `CLIENT_IP_HEADER=x-forwarded-for`: the server reads the **last** entry
  of `X-Forwarded-For`. The proxy that first receives the client sets the
  header to the client's address, overwriting what the client sent, and
  every proxy after it passes the header through unchanged rather than
  append to it. A second proxy that appends (nginx's
  `$proxy_add_x_forwarded_for`) puts the first proxy's address last: every
  client then looks the same, and they share rate limits and password
  lockouts.

The rest of [Deploying](/docs/self-hosting/#behind-a-reverse-proxy) applies
as well: the event stream must not be buffered.

## The console on its own host

By default the management API is also served under `/mgmt` on port 8080,
for the [operator console](/docs/web-app/#the-operator-console). To keep it
off the public address:

* set `MANAGEMENT_MOUNT=off` and `MANAGEMENT_LISTEN_ADDR=0.0.0.0:9090`;
* have the proxy send the console host's `/mgmt/` to port 9090, with the
  prefix stripped, and everything else to 8080;
* set `MANAGEMENT_WEBAUTHN_ORIGIN` and `MANAGEMENT_WEBAUTHN_RP_ID` to the
  console's origin and host.

Never publish port 9090 itself.

## Backups

`/data` holds everything: `pg` (the database), `files` (uploads) and
`secrets` (the database passwords and `SERVER_SECRET_KEY`). Back up all
three together. Without `secrets` the server cannot open the database and
TOTP factors cannot be decrypted.

* A consistent copy: `docker stop happy`, copy `./data`, `docker start happy`.
* An online dump of the database, plus a copy of `files` and `secrets`:

  ```sh
  docker exec happy sh -c 'PGPASSWORD=$(cat /data/secrets/postgres_password) \
    /opt/postgresql/bin/pg_dump -h /data/run -U postgres -Fc happy_enterprise' > happy.dump
  ```

## Upgrades

Build the new image and recreate the container on the same `/data`
(`docker compose up -d --build`). Migrations run at startup and only move
forward, so take a backup first. The embedded Postgres stays on major
version 18; a future major upgrade will come with its own instructions.

## External Postgres

Set `DATABASE_URL` (a role that may run migrations and create roles),
`ORG_DATABASE_URL` and `MANAGEMENT_DATABASE_URL` (the
`happy_enterprise_org` and `happy_enterprise_management` roles, with
passwords), and no Postgres runs in the container. `/data` then holds only
the files and the generated `SERVER_SECRET_KEY`. See
[Deploying](/docs/self-hosting/#database) for the roles.

Compose has this as a profile, with a `postgres:18` container whose init
script creates the runtime roles:

```sh
# in .env: POSTGRES_PASSWORD, ORG_ROLE_PASSWORD, MANAGEMENT_ROLE_PASSWORD
docker compose --profile external up -d happy-enterprise-external
```

## Moving files to S3 later

The local store and the S3 store lay files out the same way,
`<organization id>/<file id>` under their root. To move a local
deployment's files to a bucket:

1. copy `/data/files` into the bucket under the prefix you will use, with
   `rclone` or `aws s3 sync ./data/files s3://<bucket>/happy/`;
2. set `STORAGE_BACKEND=s3`, the `S3_*` variables, and an `S3_PREFIX` that
   matches (`happy/`: the prefix is put in front of
   `<organization id>/<file id>` as it is, so end it with `/`);
3. restart.

Stop the container while copying, or copy again after stopping it, so
uploads made in between are not left behind. The stores were designed to
match for this, but the move has not been tested end to end: try it on a
copy first.

## Small hosts

Compiling the server takes several GB of memory. On a small host, build the
release binaries and the web app elsewhere and only assemble the image
there, with the distribution's `Dockerfile.prebuilt`. Build the binaries
for the host's architecture on glibc 2.41 or older (Ubuntu 24.04, for
example).

## Turning passwords off

* Organization users: `ORG_PASSWORD_AUTH=false`. Every password route is
  refused and users sign in with email codes, so configure email first.
  Stored passwords are kept, unused.
* Operators: `MANAGEMENT_AUTH=webauthn` (security keys only) or `jwt`.
  Make sure every operator has a [security key](/docs/self-hosting/operators/)
  before dropping `password`.
