---
layout: ../../../layouts/Docs.astro
title: API overview
lead: Two HTTP APIs on two listeners. Requests and responses are JSON, credentials are bearer tokens, and errors share one shape.
---

| | Organization API | Management API |
|---|---|---|
| Default address | `0.0.0.0:8080` | `127.0.0.1:9090` (keep it private) |
| Who calls it | your organizations' users, agents, apps, MCP clients | you, the operator |
| Credentials | session tokens, external JWTs, agent API tokens, OAuth access tokens (MCP only) | Ed25519 JWTs signed by a key in `MANAGEMENT_JWT_PUBLIC_KEYS` |
| JWT audience | `happy-enterprise:org` (REST), `happy-enterprise:mcp` (MCP) | `happy-enterprise:management` |
| Database access | a role confined by row level security to the request's organization | a role that sees only the list of organizations and their identity provider keys |

The two listeners share no routes, credentials, or database roles. A token for
one audience is rejected by the others.

## Reading this reference

Each endpoint lists:

- **Auth**: `none` (the login endpoints, which name the organization in the
  path), `partial` (a session still waiting for its second factor is enough),
  or `full` (a fully authenticated credential; partial sessions get
  `403 mfa_required`).
- **Permission**: what the caller must hold, see
  [Users, teams, permissions](/docs/concepts/organizations/#permissions).
  *owner* means a member of `owners` using a first-party credential (not an
  OAuth grant).

Examples use these shell variables:

```sh
BASE=https://enterprise.example.com     # PUBLIC_BASE_URL
ORG=c8kq2m7xw3n5p9r1t4v6y0za            # organization id
TOKEN=eyJhbGciOiJFZERTQSIsImtpZCI6ImhlLXNlc3Npb24tdjEifQ...   # session token
```

## Conventions

- Bodies are JSON (`Content-Type: application/json`), except image uploads
  (raw bytes) and the OAuth token and revocation endpoints (form-encoded).
- Ids are cuid2 strings, 24 characters, `^[a-z][a-z0-9]{23}$`. A malformed id
  in a path is a `404`, like an unknown one.
- Timestamps are RFC 3339 in UTC.
- Unknown JSON fields are refused by the ontology and security-posture endpoints.
- `DELETE`s and other writes without a body answer `204 No Content`.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "not_found", "message": "not found" } }
```

Validation and schema errors add `details`, a list of
`{ path?, object_id?, message }`:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "the properties do not satisfy the object type",
    "details": [
      { "path": "email", "message": "must be an email address" },
      { "path": "age", "message": "must be at least 16" }
    ]
  }
}
```

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | malformed input; the message says what |
| 401 | `unauthorized` | any authentication failure, always identical; carries `WWW-Authenticate: Bearer` |
| 403 | `forbidden` | authenticated, but missing a permission |
| 403 | `mfa_required` | the organization requires 2FA and this session has not completed it |
| 404 | `not_found` | unknown, or not visible to you |
| 409 | `conflict` | a uniqueness, version, or team-rule conflict |
| 409 | `version_conflict` | an object an [action](/docs/concepts/actions/) reads is not at its expected version, or changed before its edits ran |
| 409 | `idempotency_conflict` | an action's idempotency key was used for a different request |
| 413 | `payload_too_large` | an image over 5 MB |
| 422 | `validation_failed` | content that breaks its rules, with `details` |
| 422 | `criteria_failed` | an action's criteria do not hold, one detail per criterion |
| 429 | `rate_limited` | see [Rate limits](/docs/concepts/rate-limits/); carries `Retry-After` |
| 502 | `upstream` | the email provider or object store failed |
| 503 | `validators_unavailable` | a write owes custom validator or format calls but no sandbox is configured |
| 500 | `internal` | a bug; details are only in the server log |

Resources you are not allowed to see answer `404` rather than `403` where
admitting they exist would leak something: other members' avatars, restricted
object types, other users' sessions.

## Health

### GET /health

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Listener</b>both</span></p>

```json
{ "status": "ok" }
```

## Example resource: objects

`/v1/objects` is a minimal per-organization resource kept as an example of
the pattern every table of organization data follows (a transaction scoped to
the organization, an explicit organization filter, RLS underneath). For real data, use the [ontology](/docs/api/ontology-objects/).

### GET /v1/objects

<p class="ep-meta"><span><b>Auth</b>full</span></p>

Every object of the organization, oldest first.

### POST /v1/objects

<p class="ep-meta"><span><b>Auth</b>full</span></p>

```json
{ "name": "first", "data": { "any": "json" } }
```

`201` with `{ id, name, data, created_at, updated_at }`. `name` is 1-200
characters and unique per organization (`409` otherwise).

### GET /v1/objects/{id}

<p class="ep-meta"><span><b>Auth</b>full</span></p>

### DELETE /v1/objects/{id}

<p class="ep-meta"><span><b>Auth</b>full</span></p>

`204`.
