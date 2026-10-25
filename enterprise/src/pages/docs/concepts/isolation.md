---
layout: ../../../layouts/Docs.astro
title: Organizations and isolation
lead: Organizations never see or affect each other's data. Three independent layers make sure of it, so a bug in one is caught by the next.
---

Every organization's data lives in the same Postgres database, and every row
records the organization it belongs to. This page explains how a request for
one organization is kept from reading or writing another organization's rows,
even when the code serving it has a bug.

## Layer 1: one scoped transaction per request

Request handlers never get a connection pool. The only way a handler reaches
the database is a transaction the server opens for it after it:

1. reads the `Authorization: Bearer` credential,
2. verifies it and resolves it to an organization and an active user of that
   organization, together with how they authenticated, whether the session
   has passed its second factor, and any OAuth scopes,
3. opens a transaction and sets the organization for that transaction only.

A handler cannot make up a context for another organization: only the
verifier creates one. Login and OAuth endpoints, which run before anyone is
signed in, get a narrower transaction scoped to the organization named in
the URL.

Queries still filter by organization explicitly. The next layer is the
backstop, not the only check.

## Layer 2: Postgres row level security

Every table has row level security enabled and forced, so it applies to the
table owner too. Every table that holds an organization's data carries the
same policy for reads and writes:

```sql
CREATE POLICY tenant_isolation ON users TO happy_enterprise_tenant
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
```

`tenant_id` is the row's organization ID, and `app_current_tenant_id()`
returns the organization set for the current transaction. (The schema calls
an organization a *tenant*.) Three properties follow:

- **A query that forgets to filter by organization still sees only its own
  organization's rows.** `USING` filters every `SELECT`, `UPDATE`, and
  `DELETE`.
- **A write cannot produce a row of another organization.** `WITH CHECK`
  refuses any inserted or updated row whose organization is not the
  transaction's.
- **No organization means no rows.** When no organization is set, the
  comparison is never true and every policy matches nothing. A request that
  somehow skipped the first layer would see and change nothing.

The setting is transaction-local, so a pooled connection never carries one
organization's scope into its next use.

One table carries a second policy: objects also have a *restrictive* policy,
`object_access`, that limits a member to the objects of restricted types
they may see, down to the [objects assigned to them](/docs/concepts/ontology/#assigned-objects).
A restrictive policy can only narrow what the organization policy shows,
never widen it, so it cannot reach across organizations either.

### Database roles

The server connects with two runtime roles, neither a superuser and neither
able to bypass row level security:

| Role | Used by | Can reach |
|---|---|---|
| `happy_enterprise_tenant` | the organization API | organization data, under the policy above; column-level grants keep it from changing ids, user kinds, or email addresses |
| `happy_enterprise_management` | the management API | only the list of organizations and their identity provider keys: no grants on organization data |

Migrations run as a third, owning role (`DATABASE_URL`). The migrations
check that the runtime roles cannot bypass row level security, and the server
refuses to start if either connection is logged in as the wrong role or as a
role that can. Triggers run with the caller's rights, so they too see only
the caller's organization, and there are no functions or views that run with
elevated rights.

## Layer 3: tests

Integration tests run against a real Postgres and check, for every table of
organization data found in the database catalog, that:

- reads across organizations return nothing, including `SELECT`s with no
  `WHERE`,
- inserts and updates across organizations fail, and `UPDATE`/`DELETE`
  without a `WHERE` touch only the caller's rows,
- a transaction without an organization sees and changes nothing,
- the organization scope does not outlive its transaction,
- every table has forced row level security, organization tables have
  exactly the expected policy (objects also the restrictive one), and the
  role grants are minimal.

Because the tests read the catalog, a new table without the policy fails
them.

Isolation and authorization rules are enforced by PostgreSQL row-level
security and covered by machine-checked models and integration tests.

## What this does not cover

These layers keep a request handler that forgets to filter by organization,
or filters by the wrong one, from reaching another organization's data. They
are not a sandbox for code that sets out to get around them, and they do not
make it safe to run arbitrary agent-written backend code inside the server.
Code running in the server process has the server's own configuration: the
connection strings for both runtime roles (and for the owning role, when the
server runs migrations) and `SERVER_SECRET_KEY`. Such code could open its own
connection or sign its own session tokens.

Review server code an agent writes as you would any other change to the
server. The one place Happy Enterprise runs untrusted code is
[custom validators](/docs/concepts/validators/), in a sandbox with no
filesystem, network, or imports.

## Ids

Every id is a [cuid2](https://github.com/paralleldrive/cuid2): 24 characters
matching `^[a-z][a-z0-9]{23}$`, enforced by the Postgres domain `cuid` and
generated by the application. Ids are not secret, but they are not
sequential either, so they say nothing about how many rows exist.

## Not revealing what exists

Isolation also covers what an outsider can learn. Every authentication
failure is the same `401 unauthorized`, whether the organization, user, key,
session, invite, or `kid` exists or not. Login and invite endpoints answer
for an unknown organization exactly as for a failed login, and OAuth
discovery and client registration answer for one exactly as for a real one.
Resources a caller may not see (a restricted object type, another member's
avatar) are `404`, not `403`.
