---
layout: ../../../layouts/Docs.astro
title: Business actions
lead: An action is one of your organization's business operations, such as "open a work order" or "close an incident". It takes typed inputs, checks who may run it and whether it still applies, then makes all its changes at once or none of them.
---

Objects describe what exists; actions describe what someone may make happen.
Without them, opening a work order for an incident takes several requests
(create the order, link it, update the incident), and a failure halfway
leaves the data half changed. An action does the same work in one request
and one transaction, under rules the organization defines once and every
caller meets: your app, a person's assistant over MCP, and agent accounts.

## An example

```json
{
  "api_name": "open_work_order",
  "display_name": "Open a work order",
  "description": "For an open incident",
  "parameters": [
    { "api_name": "incident", "object_type": "incident",
      "required": true },
    { "api_name": "summary", "type": { "kind": "string" },
      "required": true },
    { "api_name": "code", "type": { "kind": "string" } }
  ],
  "criteria": [
    { "name": "open",
      "message": "the incident is not open",
      "condition": { "op": "eq",
        "left": { "object": "incident", "property": "state" },
        "right": { "value": "open" } } },
    { "name": "four_eyes",
      "condition": { "op": "ne",
        "left": { "caller": "id" },
        "right": { "object": "incident",
                   "property": "$created_by" } } }
  ],
  "edits": [
    { "op": "create_object", "type": "work_order",
      "ref": "order",
      "properties": { "summary": { "param": "summary" },
                      "code": { "param": "code" } } },
    { "op": "create_link", "link": "orders",
      "from": { "param": "incident" },
      "to": { "created": "order" } },
    { "op": "update_object", "object": { "param": "incident" },
      "properties": { "assignee": { "caller": "id" } } }
  ],
  "effects": [
    { "kind": "webhook",
      "url": "https://hooks.acme.example/work-orders" }
  ]
}
```

Applying it:

```http
POST /v1/actions/open_work_order/apply
{ "params": { "incident": "o4b8j2e6c0t1q5w9r3y7u2i6",
              "summary": "Replace the seal" },
  "idempotency_key": "triage-2026-10-25-42",
  "expected_versions": { "incident": 3 } }
```

creates the work order, links it to the incident, and assigns the incident
to the caller, in one transaction. If the incident is closed, if the caller
opened it themselves, or if it changed since the caller read version 3,
nothing changes and the response says which.

## Who may apply an action

- **Defining** an action needs `manage_ontology` and view access to every
  object type it names.
- **Applying** it needs a grant: owners grant teams the right to apply each
  action, and owners may always apply them. The grant stands in for
  `edit_objects`, so a team can open work orders without being able to edit
  incidents freely.
- The caller still needs **view access to every object type** the action
  touches. Restricting a type hides the actions that touch it from anyone
  who may not view it.
- Through MCP, the grant also needs the `actions:apply` scope, and
  `ontology:read` for the touched types. See [MCP and OAuth](/docs/concepts/mcp/).

`GET /v1/actions` lists the actions the caller may apply, with a JSON Schema
of each one's parameters, so a client or an agent can build the request.

## Parameters

Parameters are typed like properties: a `type`, `required`, and `rules`,
custom validators and formats included. Or a parameter names an
`object_type`, and its value is the id of a live object of that type. The
names `idempotency_key` and `expected_versions` are reserved.

## Criteria

Every criterion must hold for the action to apply. A criterion is either a
declarative `condition` or Python `code`.

**Conditions** combine `and`, `or`, `not`, `eq`, `ne`, `lt`, `lte`, `gt`,
`gte`, and `in` over these expressions:

| Expression | Value |
|---|---|
| `{"param": "summary"}` | a parameter |
| `{"object": "incident", "property": "state"}` | a property of a parameter's object; also `$id`, `$version`, `$created_by`, `$updated_by`, `$created_at`, `$updated_at` |
| `{"caller": "id"}`, `{"caller": "kind"}` | who is applying it, and whether they are a `human` or an `agent` |
| `{"now": true}` | the time of the request |
| `{"value": "open"}` | a literal |

**Code** defines `check(ctx)` and returns `True`, or a message saying why
not. `ctx` is `{action, params, objects, caller {id, kind}, now}`:

```python
def check(ctx):
    if ctx['objects']['incident']['properties']['severity'] >= 3:
        return True
    return 'only severe incidents are triaged'
```

A failed application lists every criterion that did not hold:

```json
{ "error": { "code": "criteria_failed", "message": "the action's criteria are not met",
  "details": [{ "path": "criteria.four_eyes", "message": "the criterion is not met" }] } }
```

## Edits

Edits are either a list or Python code that returns one:

| Edit | Does |
|---|---|
| `create_object` `{type, ref?, properties}` | creates an object; later edits refer to it as `{"created": ref}` |
| `update_object` `{object, properties}` | merges properties into a parameter's object; `null` removes one |
| `create_link`, `delete_link` `{link, from, to}` | adds or removes a link |

Values are expressions, as in conditions. Edits reach only the parameters'
objects and the objects the action creates. Each edit is an ordinary write:
checked against its type's rules, validators, uniqueness, and link
cardinality, with its own events, and recorded as made by the caller.

**Code** defines `edits(ctx)` and returns such a list with literal values. The
definition names the `object_types` the code may create and the `link_types`
it may use, and anything else is refused:

```json
"edits": { "object_types": ["work_order"], "link_types": ["orders"],
  "code": "def edits(ctx):\n    ..." }
```

An application makes at most 100 edits.

## Applying, step by step

One request, one transaction. The first step that fails ends it, and nothing
is written:

1. **Authorization**: the grant, view access, and for OAuth the scope.
   `403`.
2. **Parameters**: checked like properties. `422 validation_failed`, with
   paths like `params.summary`.
3. **Snapshot**: the parameters' objects are read. Criteria and edits see
   this snapshot.
4. **Expected versions**: if the request names `expected_versions`
   (`{param: version}`) and an object has moved on, `409 version_conflict`.
5. **Criteria**: `422 criteria_failed`.
6. **Edits**: the snapshot's objects are locked and their versions checked
   again, so the criteria held on exactly what commits. If one changed in the
   meantime, `409 version_conflict`. An edit that breaks its type's rules is
   `422` (or `409` for a unique value), with paths like
   `edits[0].properties.summary`.
7. **Record**: the audit row, the effects, and the events.

Criteria and edit code run in one sandbox run per request, 5 seconds in
total. Without a sandbox, actions with code get `503
validators_unavailable`; declarative actions are unaffected.

The result says what changed:

```json
{
  "application_id": "p2m4k6j8h0g1f3d5s7a9q1w3",
  "action": "open_work_order",
  "action_version": 1,
  "applied_at": "2026-10-25T09:12:00Z",
  "applied_by": { "id": "h3jd8s0q2l5x7c1v9b4n6m8k", "kind": "human", "via": "rest" },
  "created": [{ "type": "work_order", "id": "w7o2r4d6e8r0x1c3v5b7n9m1", "version": 1, "ref": "order" }],
  "updated": [{ "type": "incident", "id": "o4b8j2e6c0t1q5w9r3y7u2i6", "version": 4 }],
  "links": [{ "op": "create", "link": "orders", "from": "o4b8j2e6c0t1q5w9r3y7u2i6", "to": "w7o2r4d6e8r0x1c3v5b7n9m1", "changed": true }],
  "effects": [{ "id": "e5f1x9q3z7k2m8n4b6v0c2l4", "kind": "webhook", "status": "pending" }],
  "replayed": false
}
```

## Retries

Send an `idempotency_key` (1-200 characters) and a retry is safe. The key
names one application per organization, action, and caller:

- the same key with the same parameters and expected versions returns the
  stored result with `200` and `replayed: true`, and applies nothing;
- the same key with different ones is `409 idempotency_conflict`;
- two concurrent requests with one key wait for each other.

Keys are forgotten after 7 days; the audit row stays.

## Effects

Effects reach outside the database: a `webhook`, or an `email` to a user of
the organization. They are written to an outbox in the same transaction, so
they exist exactly when the application commits, and a background job
delivers them afterwards, at least once. Failed deliveries are retried after
30 seconds, doubling up to an hour, 10 attempts in all, then marked `failed`.

```json
"effects": [
  { "kind": "webhook", "url": "https://hooks.acme.example/work-orders" },
  { "kind": "email", "to": { "param": "notify" },
    "subject": "Work order for {{object.incident.title}}",
    "text": "{{caller.id}} opened {{created.order}}: {{param.summary}}" }
]
```

An email goes to the user named by `to`, through the configured
[email provider](/docs/concepts/files-and-email/). Its templates may use
`{{param.x}}`, `{{object.p.x}}`, `{{created.r}}`, `{{caller.id}}`, and
`{{action}}`. The subject is one line of up to 200 characters, the text up to
5,000.

**Webhooks** must use `https` and a public address. A webhook is a `POST` of
`{delivery_id, action, action_version, application_id, applied_at,
applied_by, params, result}` with three headers:

| Header | |
|---|---|
| `x-happy-enterprise-timestamp` | when it was sent |
| `x-happy-enterprise-signature` | `sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">`, keyed by the action's webhook secret |
| `x-happy-enterprise-delivery` | the delivery id; the same on every retry |

Owners read the secret at `GET /v1/ontology/action-types/{type}/webhook-secret`.
Verify the signature, and deduplicate on the delivery id, since a delivery
can arrive more than once.

## The audit log

Every committed application is recorded: the action and its version, who
applied it and whether they are a human or an agent, the credential (a
session, an OAuth grant with its client, an external JWT, or an API token),
whether it came through REST or MCP, the parameters, and the result. Refused
applications leave no record beyond their response. The organization API's
database role may add to the log but not change or delete it.

Owners see every application at `GET /v1/action-applications`; everyone else
sees their own. One application also shows each effect's status, attempts,
last error, and next attempt.

Each application also emits an `action.applied`
[event](/docs/concepts/live-events/) carrying its result, after the events of
the objects it changed.

## Versions

Action types are versioned like object types. A `PUT` with
`expected_version` makes a new version, and every version is kept.
Applications record the version they ran. `DELETE` removes the action from
use; the audit log keeps referring to it.

See the [Actions API](/docs/api/actions/) for every endpoint.
