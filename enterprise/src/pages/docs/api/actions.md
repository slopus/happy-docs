---
layout: ../../../layouts/Docs.astro
title: Actions
lead: Define action types, grant teams the right to apply them, apply them, schedule them, and read the audit log.
---

[Business actions](/docs/concepts/actions/) explains parameters, criteria,
edits, effects, and what applying does, step by step. Action types are
addressed by their `api_name`.

## Action types

An action type in responses: its definition, and its version.

```json
{
  "id": "a1c2t3i4o5n6t7y8p9e0x1z2",
  "api_name": "open_work_order",
  "display_name": "Open a work order",
  "description": "For an open incident",
  "parameters": [ { "api_name": "incident", "object_type": "incident", "required": true } ],
  "criteria": [ { "name": "open", "message": "the incident is not open", "condition": { "...": "..." } } ],
  "edits": [ { "op": "create_object", "type": "work_order", "ref": "order", "properties": { "...": "..." } } ],
  "effects": [],
  "version": 1,
  "created_at": "2026-10-25T09:00:00Z",
  "updated_at": "2026-10-25T09:00:00Z"
}
```

### GET /v1/ontology/action-types

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology</span></p>

`{ "action_types": [...] }`: every action type that has not been deleted,
ordered by `api_name`.

### POST /v1/ontology/action-types

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology + view access to every type it names</span></p>

`{api_name, display_name, description?, parameters, criteria, edits, effects}`.
`api_name` matches `[a-z][a-z0-9_]{0,62}`. `201` with the action type, `400`
for unknown fields, `409` if the name is taken, and `422` listing every
problem in the definition: unknown types, link types, properties, or
parameters, reserved parameter names, a webhook to a private address.

Limits: 50 parameters, 50 criteria, 50 edits, 10 effects, 16 object types; a
condition has at most 100 nodes, nested at most 10 deep.

### GET /v1/ontology/action-types/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology + view access to every type it names</span></p>

The action type, or `404`.

### PUT /v1/ontology/action-types/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology + view access to every type it names</span></p>

The full definition plus `expected_version`. `200` with the new version;
`409` if `expected_version` is not the current one.

### DELETE /v1/ontology/action-types/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology + view access to every type it names</span></p>

`204`. Nobody can apply it any more and its name is free again; the audit log
keeps its applications.

### GET /v1/ontology/action-types/{type}/versions

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology + view access to every type it names</span></p>

`{ "versions": [...] }`: every version's definition, newest first.

## Who may apply

### GET /v1/ontology/action-types/{type}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

```json
{ "grants": [{ "team_id": "t3e5a7m9o1p2e3r4a5t6o7r8" }] }
```

### PUT /v1/ontology/action-types/{type}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Replaces the grants with the body, `{ "grants": [{ "team_id": "..." }] }`.
Members of a granted team may apply the action without `edit_objects`, but
still need view access to every type it touches. Owners may always apply it.

### GET /v1/ontology/action-types/{type}/webhook-secret

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

The key the action's webhooks are signed with, per organization and action
type:

```json
{ "secret": "...",
  "signature": "x-happy-enterprise-signature: sha256=<hex HMAC-SHA256 of \"<x-happy-enterprise-timestamp>.<body>\">" }
```

It is derived from `SERVER_SECRET_KEY`, so rotating that key changes it.

## Applying

### GET /v1/actions

<p class="ep-meta"><span><b>Auth</b>full</span></p>

The actions you may apply right now, each with a JSON Schema of its
parameters:

```json
{
  "actions": [
    {
      "api_name": "open_work_order",
      "display_name": "Open a work order",
      "description": "For an open incident",
      "version": 1,
      "parameters": {
        "type": "object",
        "properties": {
          "incident": { "type": "string", "description": "id of an object of type incident" },
          "summary": { "type": "string" },
          "code": { "type": "string" }
        },
        "required": ["incident", "summary"]
      }
    }
  ]
}
```

### POST /v1/actions/{type}/apply

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a grant for the action + view access to every type it touches</span></p>

```sh
curl -X POST "$BASE/v1/actions/open_work_order/apply" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"params": {"incident": "o4b8j2e6c0t1q5w9r3y7u2i6", "summary": "Replace the seal"},
       "idempotency_key": "triage-42", "expected_versions": {"incident": 3}}'
```

`params` holds the parameters. `idempotency_key` (1-200 characters) and
`expected_versions` (`{param: version or etag}`, for object parameters, as you
see them) are optional. Versions in the result are also as you see them.

| Status | `code` | When |
|---|---|---|
| `201` | | applied; the body is the [result](/docs/concepts/actions/#applying-step-by-step) |
| `200` | | a retry with the same key and request; the stored result with `replayed: true` |
| `400` | `bad_request` | an `idempotency_key` starting with `schedule:`, which only schedules use |
| `403` | `forbidden` | no grant, no view access to a touched type, or (OAuth) no `actions:apply` scope |
| `404` | `not_found` | no such action, or it was deleted |
| `409` | `version_conflict` | an object is not at its expected version, or it or the links between the parameters' objects changed before the edits ran (path `links`) |
| `409` | `idempotency_conflict` | the key was used for a different request |
| `409` | `conflict` | an edit would duplicate a unique value |
| `422` | `validation_failed` | a parameter or an edit breaks its rules; paths `params.x`, `edits[i].properties.x` |
| `422` | `criteria_failed` | criteria do not hold; one detail per criterion, `criteria.<name>` |
| `503` | `validators_unavailable` | the action, a parameter, or an edit needs the sandbox and none is configured |

## The audit log

An application in the log:

```json
{
  "id": "p2m4k6j8h0g1f3d5s7a9q1w3",
  "action": "open_work_order",
  "action_version": 1,
  "applied_by": { "id": "h3jd8s0q2l5x7c1v9b4n6m8k", "kind": "human", "method": "session", "via": "rest",
                  "session_id": "s1e2s3s4i5o6n7i8d9x0y1z2", "oauth_client_id": null },
  "params": { "incident": "o4b8j2e6c0t1q5w9r3y7u2i6", "summary": "Replace the seal" },
  "result": { "...": "the result the caller received" },
  "applied_at": "2026-10-25T09:12:00Z"
}
```

`method` is `session`, `oauth`, `external_jwt`, `api_token`, or `schedule`;
`via` is `rest`, `mcp`, or `schedule`. An application made by a
[schedule](#schedules) is by the schedule's agent and carries its
`schedule_id`.

### GET /v1/action-applications

<p class="ep-meta"><span><b>Auth</b>full</span></p>

Newest first: every application for owners, your own for everyone else.
`?action=` filters by action type, `?limit=` (default 50, at most 200) and
`?cursor=` page through `{ "applications": [...], "next_cursor": ... }`.

### GET /v1/action-applications/{id}

<p class="ep-meta"><span><b>Auth</b>full</span></p>

One application, with the delivery state of each effect:

```json
"effects": [
  { "id": "e5f1x9q3z7k2m8n4b6v0c2l4", "kind": "webhook", "status": "pending", "attempts": 1,
    "last_error": "the webhook answered 500 Internal Server Error", "next_attempt_at": "2026-10-25T09:13:00Z", "delivered_at": null }
]
```

`status` is `pending`, `delivered`, or `failed`. `404` for another user's
application unless you are an owner.

## Schedules

[Schedules](/docs/concepts/actions/#schedules) apply an action on a
recurrence, as an agent. Schedules are addressed by their `api_name`. Every
endpoint here is for owners.

A schedule in responses:

```json
{
  "id": "s1c2h3e4d5u6l7e8x9y0z1a2",
  "api_name": "bins",
  "description": "Kim takes out the bins every week",
  "action": "assign_chore",
  "run_as": "c4r3t4k3r0a1g2e3n4t5x6y7",
  "params": { "title": "Take out the bins", "assignee": "k1m2u3s4e5r6x7y8z9a0b1c2", "points": 5 },
  "occurrence_param": "due_at",
  "every": 1,
  "unit": "week",
  "starts_at": "2026-11-02T08:00:00Z",
  "ends_at": null,
  "enabled": true,
  "next_occurrence": 1,
  "next_at": "2026-11-09T08:00:00Z",
  "runs": 1,
  "failures": 0,
  "last_occurrence_at": "2026-11-02T08:00:00Z",
  "last_run_at": "2026-11-02T08:00:03Z",
  "last_application_id": "p2m4k6j8h0g1f3d5s7a9q1w3",
  "last_error": null,
  "created_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "created_at": "2026-11-01T12:00:00Z",
  "updated_at": "2026-11-02T08:00:03Z"
}
```

`next_at` is `null` once the schedule has ended.

### GET /v1/ontology/action-schedules

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

`{"schedules": [...]}`.

### POST /v1/ontology/action-schedules

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

```json
{ "api_name": "bins", "description": "Kim takes out the bins every week",
  "action": "assign_chore", "run_as": "<an agent>",
  "params": { "title": "Take out the bins", "assignee": "<kim>", "points": 5 },
  "occurrence_param": "due_at",
  "every": 1, "unit": "week", "starts_at": "2026-11-02T08:00:00Z" }
```

`api_name` is `[a-z][a-z0-9_]{0,62}`, unique among the organization's
schedules (`409`). `every` is 1-1000 and `unit` one of `minute`, `hour`,
`day`, `week`, `month`. `ends_at`, `params` (default `{}`), `occurrence_param`,
`enabled` (default `true`), and `description` (up to 2,000 characters) are
optional. `201` with the schedule.

`422` for an unknown action, a parameter the action does not have, an
`occurrence_param` that is not one of its timestamp parameters or is also in
`params`, a `run_as` that is not an active agent, or an `ends_at` not after
`starts_at`. Whether the parameters satisfy the action is checked when each
occurrence is applied.

### GET /v1/ontology/action-schedules/{schedule}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

The schedule.

### PATCH /v1/ontology/action-schedules/{schedule}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

```json
{ "enabled": false }
```

Changes `description`, `params`, or `enabled`; the action, the agent, and the
recurrence never change. A paused schedule that is enabled again applies only
its latest due occurrence. New `params` make a rerun of an occurrence the job
had started a `409 idempotency_conflict`, recorded as a failure.

### DELETE /v1/ontology/action-schedules/{schedule}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

`204`. Applications it made stay in the audit log.
