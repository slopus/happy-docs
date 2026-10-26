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
- Actions see only the objects the caller can see. With
  [shared and assigned objects](/docs/concepts/ontology/#shared-and-assigned-objects),
  passing an object that is not shared with the caller is refused like an
  unknown one (`422`, at `params.<name>`), and edits that would take an
  object out of the caller's sight are `403`. A `file_ref` parameter must
  name a file the caller can read.
- Actions read and write whole objects, including
  [restricted properties](/docs/concepts/ontology/#restricted-properties)
  the caller may not see: the grant stands in for property access as it does
  for `edit_objects`. The result names objects by id only.
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
`gte`, `in`, `is_null`, and `contains` over these expressions:

| Expression | Value |
|---|---|
| `{"param": "summary"}` | a parameter |
| `{"object": "incident", "property": "state"}` | a property of a parameter's object; also `$id`, `$version`, `$created_by`, `$updated_by`, `$created_at`, `$updated_at` |
| `{"caller": "id"}`, `{"caller": "kind"}`, `{"caller": "teams"}` | who is applying it, whether they are a `human` or an `agent`, and the ids of their teams |
| `{"team": "maintainers"}` | the id of the team with that name, or `null` |
| `{"user": <expression>, "field": "kind"}`, `"field": "teams"` | the kind or the team ids of another user: the expression is a user id, such as a `user_ref` parameter or property |
| `{"now": true}` | the time of the request |
| `{"value": "open"}` | a literal |

`contains` holds when a list holds a value. With the team expressions it asks
whether someone is on a team:

```json
{ "op": "contains", "list": { "caller": "teams" }, "value": { "team": "maintainers" } }
```

```json
{ "op": "eq",
  "left": { "user": { "object": "pull_request", "property": "author" }, "field": "kind" },
  "right": { "value": "agent" } }
```

The first holds when the caller is a maintainer, the second when the pull
request's author is an agent. Teams here are always **effective teams**:
current memberships, plus every team above them along inherited
[subteam links](/docs/concepts/organizations/#subteams), the same teams grants
reach. A user who is not in the organization has no kind and no teams
(`null`).

One more condition looks at links:

```json
{ "op": "linked", "link": "reservation_car",
  "from": { "param": "reservation" }, "to": { "param": "car" } }
```

It holds when a link of that type, visible to the caller, joins the two
object parameters' objects: the reservation is for this car, the trade-in
belongs to this deal. Without it, a caller could pass a car and someone
else's reservation and have the criteria judge them as a pair.

**Code** defines `check(ctx)` and returns `True`, or a message saying why
not. `ctx` is `{action, params, objects, links, caller {id, kind, teams},
teams, users, now}`:

- `links` lists the links between the parameters' objects, of the link types
  the definition uses, as `{link, from, to}`;
- `teams` maps team names to ids: every team when the definition has code,
  otherwise the teams it names;
- `users` maps user ids to `{kind, teams}` for the caller, the users that
  `user` expressions name, the `user_ref` parameters, and the `user_ref`
  values of the parameters' objects, at most 1000.


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
| `add_member` `{team, user, expires_at?}` | adds a user to a team, or renews their membership, until `expires_at` or for good |
| `remove_member` `{team, user}` | ends a user's membership of a team |

Values are expressions, as in conditions. Edits reach only the parameters'
objects and the objects the action creates. Each edit is an ordinary write:
checked against its type's rules, validators, uniqueness, and link
cardinality, with its own events, and recorded as made by the caller.

The `team` of a membership edit is an object parameter of a
[team type](/docs/concepts/ontology/#team-types), so `owners` and `everyone`
are out of reach; only active users of the organization join, and
`expires_at` must be in the future (`422` otherwise, at the edit's path). A membership edit
is recorded in the team's
[history](/docs/concepts/organizations/#membership-history) as made by the
caller and sent as a `team.member_added` or `team.member_removed` event. The
action's grant stands in for edit access to the team, as for any edit, so
adults may host a guest without managing the guests team freely:

```json
"edits": [
  { "op": "add_member", "team": { "param": "stay" }, "user": { "param": "guest" },
    "expires_at": { "param": "until" } }
]
```

**Code** defines `edits(ctx)` and returns such a list with literal values. The
definition names the `object_types` the code may create and the `link_types`
it may use, and anything else is refused; membership edits may name only
the team parameters' teams:

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
3. **Snapshot**: the parameters' objects, and the links between them, are
   read. Criteria and edits see this snapshot.
4. **Expected versions**: if the request names `expected_versions`
   (`{param: version}`) and an object has moved on, `409 version_conflict`.
5. **Criteria**: `422 criteria_failed`.
6. **Edits**: the snapshot's objects are locked, and their versions and the
   links between them are checked again, so the criteria held on exactly what
   commits. If one changed in the meantime, `409 version_conflict`, at the
   parameter's path or at `links`. Link writes lock both their objects, so the
   links cannot change between this check and the commit. An edit that breaks its type's rules is
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
  "memberships": [],
  "effects": [{ "id": "e5f1x9q3z7k2m8n4b6v0c2l4", "kind": "webhook", "status": "pending" }],
  "replayed": false
}
```

`memberships` lists the membership edits as `{op, team, user, expires_at,
changed}`, with `op` `add` or `remove`; `changed` is `false` for removing a
membership there was none of. The result names objects by id only, so it
never carries a property the caller may not see.

## Retries

Send an `idempotency_key` (1-200 characters) and a retry is safe. The key
names one application per organization, action, and caller:

- the same key with the same parameters and expected versions returns the
  stored result with `200` and `replayed: true`, and applies nothing;
- the same key with different ones is `409 idempotency_conflict`;
- two concurrent requests with one key wait for each other.

Keys are forgotten after 7 days; the audit row stays. Keys starting with
`schedule:` are reserved for [schedules](#schedules) (`400`).

## Effects

Effects reach outside the database: a `webhook`, or an `email` to a user of
the organization or to an outside address. They are written to an outbox in the same transaction, so
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

**Emails** go through the configured
[email provider](/docs/concepts/files-and-email/), to exactly one of:

- `to`: a user id expression. The email goes to that user's address while
  they are an active member of the organization.
- `to_address`: an address outside the organization, such as a customer or
  a supplier. The expression must be a string parameter or property with the
  `email` rule, or a literal address, so an action can only write to
  addresses that were checked as addresses.

```json
{ "kind": "email",
  "to_address": { "object": "deal", "property": "customer_email" },
  "subject": "Your invoice {{created.invoice.number}}",
  "text": "Dear {{object.deal.customer_name}}, ..." }
```

Templates may use `{{param.x}}`, `{{object.p.x}}`, `{{created.r}}` (a created
object's id), `{{created.r.x}}` (one of its properties, as written, including
a [sequence](/docs/concepts/ontology/#sequences) number), `{{caller.id}}`, and
`{{action}}`. The subject is one line of up to 200 characters, the text up to
5,000.

Emails to outside addresses end with the line
`Sent for <organization> by Happy Enterprise.` and are limited to 200 an hour
per organization ([rate limits](/docs/concepts/rate-limits/)). Over the
limit, a delivery waits for room without using up one of its attempts.

**Conditional effects.** Any effect may carry `when`, a condition in the
same syntax as criteria. The effect is enqueued only if it held on the
snapshot the action applied to:

```json
{ "kind": "email", "to": { "param": "approver" },
  "when": { "op": "gt", "left": { "param": "amount" }, "right": { "value": 1000 } },
  "subject": "Discount of {{param.amount}} needs your decision",
  "text": "{{param.reason}}" }
```

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
session, an OAuth grant with its client, an external JWT, an API token, or a
[schedule](#schedules)), whether it came through REST, MCP, or a schedule, the parameters, and the result. Refused
applications leave no record beyond their response. The organization API's
database role may add to the log but not change or delete it.

Owners see every application at `GET /v1/action-applications`; everyone else
sees their own. One application also shows each effect's status, attempts,
last error, and next attempt.

Each application also emits an `action.applied`
[event](/docs/concepts/live-events/) carrying its result, after the events of
the objects it changed.

## Schedules

Owners can schedule an action to be applied on a recurrence: a monthly
check, a weekly chore, a nightly cleanup.

```json
POST /v1/ontology/action-schedules
{ "api_name": "smoke_alarms",
  "description": "Test the smoke alarms every month",
  "action": "schedule_task",
  "run_as": "<caretaker agent>",
  "params": { "room": "<hall>", "title": "Test the smoke alarms" },
  "occurrence_param": "due_at",
  "every": 1, "unit": "month",
  "starts_at": "2026-11-01T09:00:00Z" }
```

- **When.** Every 1 to 1,000 `unit`s, which are `minute`, `hour`, `day`,
  `week`, or `month`, from `starts_at` until `ends_at`, if set. Months are
  calendar months from `starts_at`, on its day of the month, or the month's
  last day when it has fewer. Times are UTC.
- **As whom.** Each occurrence is applied as `run_as`, an active agent of the
  organization. The agent needs the action's grant like anyone else, and its
  permissions decide what the action reaches.
- **With what.** `params` are fixed. `occurrence_param`, if set, names a
  timestamp parameter that receives each occurrence's time, such as a chore's
  `due_at`.
- **Once.** The maintenance job applies each occurrence with the idempotency
  key `schedule:<id>:<n>`, so an occurrence applies at most once, even if the
  job stops halfway and runs it again. If occurrences were missed, because
  the schedule was paused or the server was down, only the latest due one is
  applied; the others are skipped.
- **Refusals.** An occurrence that is refused (no grant, failed criteria, a
  deactivated agent, a deleted action) still counts as a run: it adds to the
  schedule's `failures` and sets `last_error`, and the schedule goes on.

A schedule shows its progress: `next_occurrence` and `next_at` (`null` once
it has ended), `runs`, `failures`, `last_occurrence_at`, `last_run_at`,
`last_application_id`, and `last_error`. Its `description`, `params`, and
`enabled` can change; its action, agent, and recurrence cannot, so delete it
and create another. In the audit log, its applications are by the agent,
with `method` and `via` both `schedule` and the schedule's id. See the
[Actions API](/docs/api/actions/#schedules).

## Versions

Action types are versioned like object types. A `PUT` with
`expected_version` makes a new version, and every version is kept.
Applications record the version they ran. `DELETE` removes the action from
use; the audit log keeps referring to it.

See the [Actions API](/docs/api/actions/) for every endpoint.
