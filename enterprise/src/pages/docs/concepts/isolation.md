---
layout: ../../../layouts/Docs.astro
title: Organizations and isolation
lead: Organizations never see or affect each other's data, and three independent layers make sure of it.
---

Every organization's data lives in the same Postgres database, and every row
records the organization it belongs to. This page explains how a request for
one organization is kept from reading or writing another organization's rows,
even when the code serving it has a bug.

The code and the database schema call an organization a *tenant*.
Where this page shows an exact name from the code or the schema, read
"tenant" as "organization": `tenant_id` is the organization ID column,
`TenantTx` is a transaction scoped to one organization, and so on.

## Layer 1: the type system

Organization API handlers never receive a connection pool. The only database
handle they can ask for is a `TenantTx`, an axum extractor that:

1. reads the `Authorization: Bearer` credential,
2. verifies it and resolves it to a `TenantContext` (organization, user,
   how they authenticated, whether the session is fully authenticated, and
   any OAuth scopes),
3. opens a transaction and runs `SELECT set_config('app.tenant_id', $1, true)`
   with the context's organization ID.

The context has private fields, and only the verifier constructs one. So
a handler cannot invent a context for another organization, and it cannot
reach the database without one.

```rust
async fn list_members(mut tx: TenantTx) -> Result<Json<Vec<UserView>>, ApiError> {
    tx.require(Permission::ViewMembers).await?;
    let tenant_id = tx.tenant_id().to_owned();
    let rows: Vec<UserRow> = sqlx::query_as(/* ... WHERE u.tenant_id = $1 ... */)
        .bind(&tenant_id)
        .fetch_all(tx.conn())
        .await?;
    tx.commit().await?;
    Ok(Json(rows.into_iter().map(UserView::from).collect()))
}
```

There is a second, narrower handle: `OrgTx`, scoped to the organization a
request *names* (the `{org}` path segment of login and OAuth endpoints, or the
`tid` claim of a token being verified). Only the authentication modules
(`auth.rs`, `login.rs`, and `oauth.rs` under `src/tenant/`) may open one, and
`tests/guardrails.rs` checks this mechanically, along with the rule that the
organization setting `app.tenant_id` is set nowhere except `tx.rs`.

Queries still filter by organization explicitly. The next layer is the
backstop, not the only check.

## Layer 2: Postgres row level security

Every table has `ENABLE` and `FORCE ROW LEVEL SECURITY`. Every table that
holds an organization's data carries the same policy for reads and writes:

```sql
CREATE POLICY tenant_isolation ON users TO happy_enterprise_tenant
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
```

`app_current_tenant_id()` returns the organization ID set for the current
transaction:

```sql
CREATE FUNCTION app_current_tenant_id() RETURNS cuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::cuid $$;
```

Three properties follow:

- **A query that forgets to filter by organization still sees only its own
  organization's rows.** `USING` filters every `SELECT`, `UPDATE`, and
  `DELETE`.
- **A write cannot produce a row of another organization.** `WITH CHECK`
  refuses any inserted or updated row whose organization is not the
  transaction's.
- **No organization means no rows.** When no organization is set the function
  returns `NULL`, the comparison is never true, and every policy matches
  nothing. A missing `TenantTx` fails closed.

The setting is transaction-local (`set_config(..., true)`), so a pooled
connection never carries one organization's scope into its next checkout.

### Database roles

The server connects with two runtime roles, both `NOSUPERUSER NOBYPASSRLS`:

| Role | Used by | Can reach |
|---|---|---|
| `happy_enterprise_tenant` | the organization API | organization data, under the isolation policy; column-level grants keep it from changing ids, user kinds, or email addresses |
| `happy_enterprise_management` | the management API | only the list of organizations (`tenants`) and their identity provider keys (`tenant_signing_keys`): no grants on organization data |

Migrations run as a third, owning role (`DATABASE_URL`). The migrations
assert that the runtime roles cannot bypass RLS, and the server refuses to
start if either pool is logged in as the wrong role or as a role that can.
Trigger functions are `SECURITY INVOKER`, so they too see only the caller's
organization, and there are no `SECURITY DEFINER` functions or views at all.

### Every new organization table

The repository's rules for a new table of organization data:

- a `tenant_id cuid` column for the organization ID, defaulting to
  `app_current_tenant_id()`,
- `ENABLE` and `FORCE ROW LEVEL SECURITY`,
- the standard `tenant_isolation` policy for `USING` and `WITH CHECK`,
- coverage in `crates/server/tests/isolation.rs`, whose fixture writes a row
  to every organization table so the catalog-driven tests check it.

## Layer 3: tests and proofs

`tests/isolation.rs` runs against a real Postgres and checks, for every
organization table found in the catalog, that:

- reads across organizations return nothing, including `SELECT`s with no
  `WHERE`,
- inserts and updates across organizations fail, and `UPDATE`/`DELETE`
  without a `WHERE` touch only the caller's rows,
- a transaction without an organization sees and changes nothing,
- the organization scope does not outlive its transaction,
- every table has forced RLS, organization tables have exactly the expected
  policy, no `SECURITY DEFINER` function exists, and the role grants are
  minimal.

The Lean model in `proofs/HappyEnterprise/Rls.lean` proves the same
properties for the policy itself, for any type of organization ID and any
query predicate, and `Request.lean` composes them with the verifier into
"an authenticated request reads and writes only its own organization's rows".
See [Formal verification](/docs/verification/).

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
