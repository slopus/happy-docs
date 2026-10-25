---
layout: ../../../layouts/Docs.astro
title: "Example: machine maintenance"
lead: A machine breaks down. An agent reports and assigns the incident, a technician's assistant does the work over MCP, and a supervisor approves the close. All three change the same objects, only through actions, and every refusal is explained.
---

This page walks through one complete scenario: the model, the three
actions, and every request in order, including the ones that are refused.
Everything here uses the public API, so you can load the same model into
your own organization and replay it.

## Who takes part

| | Identity | Connects with | Team |
|---|---|---|---|
| **dispatch-bot** | an agent account | REST, with its API token | `dispatch` |
| **Tess**, a technician | a person, through her assistant | MCP, with an OAuth grant of `ontology:read actions:apply` | `technicians` |
| **Sam**, a supervisor | a person, in your app | REST, with a session token, watching the event stream | `supervisors` |

Only `dispatch` holds a permission to write (`edit_objects`), so the agent
can report incidents directly. **Technicians and supervisors hold no write
permission at all.** They change incidents, work orders, and machines only
through the actions granted to them: each grant stands in for `edit_objects`
for that action's edits, and nothing else.

## The model

| Object type | Properties |
|---|---|
| `machine` | `name` (unique), `site`, `status`: `running`, `down`, or `maintenance` |
| `incident` | `title`, `severity`: `low`, `medium`, or `high`; `status`: `open`, `assigned`, `in_progress`, `awaiting_approval`, or `closed`; `assignee`, `notes`, `resolution`, `close_requested_by`, `closed_by`, `approved_by`, `closed_at` |
| `assignment` | `team`, `assignee`, `assigned_by`, `assigned_at`, `note`: one team assignment of an incident |
| `work_order` | `summary`, `priority`: `normal` or `urgent`; `status`, `opened_by` |

| Link type | From → to | Cardinality | Names |
|---|---|---|---|
| `incident_machine` | incident → machine | many to one | `machine` / `incidents` |
| `incident_assignments` | incident → assignment | one to many | `assignments` / `incident` |
| `order_incident` | work order → incident | many to one | `incident` / `work_orders` |
| `order_machine` | work order → machine | many to one | `machine` / `work_orders` |

The `status` properties are `enum` rules and the people are `user_ref`
properties, so every write, whether from an action or not, is checked against
them. Two machines are seeded: Press 7 and Conveyor 2, both `running`.

### Who sees which incidents

`incident` is a restricted type with `assignee` as its
[access property](/docs/concepts/ontology/#shared-and-assigned-objects):

| Team | Sees |
|---|---|
| `dispatch` | every incident, and may edit them (`view_objects` and `edit_objects`, scope `all`) |
| `supervisors` | every incident (`view_objects`, scope `all`) |
| `technicians` | only the incidents assigned to them (`view_objects`, scope `assigned`) |

```json
PUT /v1/ontology/object-types/incident/access
{ "restricted": true, "access_properties": ["assignee"],
  "grants": [
    { "team_id": "<dispatch>", "permission": "view_objects" },
    { "team_id": "<dispatch>", "permission": "edit_objects" },
    { "team_id": "<supervisors>", "permission": "view_objects" },
    { "team_id": "<technicians>", "permission": "view_objects", "scope": "assigned" } ] }
```

Postgres enforces it, so Tess's assistant cannot see or name an incident that
is not hers by any route: queries, links, MCP tools, or actions.

## The actions

| Action | Granted to | Does |
|---|---|---|
| `assign_incident` | `dispatch`, `supervisors` | records a team assignment, links it, sets the incident to `assigned` with its assignee, and emails the assignee |
| `create_maintenance_order` | `technicians` | the incident's assignee opens a work order, links it to the incident and the machine, sets the incident `in_progress` and the machine to `maintenance`, and sends a webhook |
| `close_incident` | `technicians`, `supervisors` | closes the incident; a high-severity one is first submitted, then approved by someone else; emails the assignee |

### assign_incident

```json
{
  "api_name": "assign_incident",
  "display_name": "Assign an incident",
  "parameters": [
    { "api_name": "incident", "object_type": "incident",
      "required": true },
    { "api_name": "team", "type": { "kind": "string" },
      "required": true, "rules": [{ "rule": "cuid" }] },
    { "api_name": "assignee", "type": { "kind": "user_ref" },
      "required": true },
    { "api_name": "note", "type": { "kind": "string" } }
  ],
  "criteria": [
    { "name": "assignable",
      "message": "only open or assigned incidents can be assigned",
      "condition": { "op": "in",
        "left": { "object": "incident", "property": "status" },
        "values": [{ "value": "open" }, { "value": "assigned" }] } }
  ],
  "edits": [
    { "op": "create_object", "type": "assignment",
      "ref": "assignment",
      "properties": {
        "team": { "param": "team" },
        "assignee": { "param": "assignee" },
        "assigned_by": { "caller": "id" },
        "assigned_at": { "now": true },
        "note": { "param": "note" } } },
    { "op": "create_link", "link": "incident_assignments",
      "from": { "param": "incident" },
      "to": { "created": "assignment" } },
    { "op": "update_object", "object": { "param": "incident" },
      "properties": { "status": { "value": "assigned" },
                      "assignee": { "param": "assignee" } } }
  ],
  "effects": [
    { "kind": "email", "to": { "param": "assignee" },
      "subject": "Incident assigned to you: {{object.incident.title}}",
      "text": "{{object.incident.title}} ({{object.incident.severity}}) is yours. Note: {{param.note}}" }
  ]
}
```

### create_maintenance_order

Two criteria: the incident is `assigned` or `in_progress`, and **the caller
is its assignee**. Only the technician the incident was handed to may open a
work order for it.

```json
"criteria": [
  { "name": "in_hand",
    "message": "the incident must be assigned or in progress",
    "condition": { "op": "in",
      "left": { "object": "incident", "property": "status" },
      "values": [{ "value": "assigned" }, { "value": "in_progress" }] } },
  { "name": "assignee",
    "message": "only the incident's assignee opens work orders",
    "condition": { "op": "eq",
      "left": { "caller": "id" },
      "right": { "object": "incident", "property": "assignee" } } }
],
"edits": [
  { "op": "create_object", "type": "work_order", "ref": "order",
    "properties": { "summary": { "param": "summary" },
                    "priority": { "param": "priority" },
                    "status": { "value": "open" },
                    "opened_by": { "caller": "id" } } },
  { "op": "create_link", "link": "order_incident",
    "from": { "created": "order" }, "to": { "param": "incident" } },
  { "op": "create_link", "link": "order_machine",
    "from": { "created": "order" }, "to": { "param": "machine" } },
  { "op": "update_object", "object": { "param": "incident" },
    "properties": { "status": { "value": "in_progress" } } },
  { "op": "update_object", "object": { "param": "machine" },
    "properties": { "status": { "value": "maintenance" } } }
],
"effects": [
  { "kind": "webhook",
    "url": "https://hooks.example.com/maintenance/orders" }
]
```

### close_incident

A declarative criterion (`not_closed`) plus a Python one for the four-eyes
rule, and Python edits, because what closing does depends on the incident.

```python
def check(ctx):
    incident = ctx['objects']['incident']['properties']
    if incident.get('severity') != 'high':
        return True
    requester = incident.get('close_requested_by')
    if requester is None:
        if ctx['params'].get('resolution') is None:
            return 'say what was done (resolution) to submit the incident for closing'
        return True
    if requester == ctx['caller']['id']:
        return 'a high-severity incident needs approval by someone other than whoever submitted it'
    return True
```

```python
def edits(ctx):
    incident = ctx['objects']['incident']['properties']
    me = ctx['caller']['id']
    target = {'param': 'incident'}
    if incident.get('severity') == 'high' and incident.get('close_requested_by') is None:
        changes = {'status': 'awaiting_approval', 'close_requested_by': me,
                   'resolution': ctx['params']['resolution']}
        return [{'op': 'update_object', 'object': target, 'properties': changes}]
    changes = {'status': 'closed', 'closed_by': me, 'closed_at': ctx['now']}
    if incident.get('severity') == 'high':
        changes['approved_by'] = me
    elif ctx['params'].get('resolution') is not None:
        changes['resolution'] = ctx['params']['resolution']
    return [{'op': 'update_object', 'object': target, 'properties': changes}]
```

The edits' definition names no object types to create and no link types,
so the code can only update the incident it was given.

## Setting it up

As an owner, through the REST API:

1. Create the three teams and give `dispatch` the `edit_objects` permission
   ([teams API](/docs/api/teams/)). Add Sam to `supervisors`, Tess to
   `technicians`, and the agent to `dispatch`.
2. Create the object types and link types
   ([schema API](/docs/api/ontology-schema/)), and restrict `incident` as
   above.
3. Create the three action types and grant each to its teams
   (`PUT /v1/ontology/action-types/{type}/access`,
   [actions API](/docs/api/actions/)).
4. Create the two machines.

## 1. The agent reports and assigns

dispatch-bot reports the incident and links it to Press 7. It may, because
`dispatch` holds `edit_objects`.

```http
POST /v1/ontology/objects/incident
Authorization: Bearer heat_...
{ "properties": { "title": "Hydraulic leak on Press 7", "severity": "high",
                  "status": "open", "notes": "Pressure dropped 30% in an hour" } }

201 { "id": "<incident>", "version": 1, ... }

PUT /v1/ontology/links/incident_machine/<incident>/<press 7>
```

It also reports a second, low-severity incident, "Belt squeal on Conveyor
2", which nobody is assigned yet. Then it assigns the leak to Tess, with an
idempotency key:

```http
POST /v1/actions/assign_incident/apply
{ "params": { "incident": "<incident>", "team": "<technicians team>",
              "assignee": "<tess>", "note": "Seal kit is in bay 3" },
  "idempotency_key": "assign-<incident>" }

201 { "application_id": "<a1>", "applied_by": { "kind": "agent", "via": "rest", ... },
      "created": [{ "type": "assignment", "ref": "assignment", ... }],
      "updated": [{ "type": "incident", "version": 2, ... }], "replayed": false, ... }
```

Suppose the answer is lost on the way back. The agent sends the same request
again and gets the first result back, `200` with `replayed: true` and the
same `application_id`. Nothing is applied twice and no second email goes
out. Tess receives "Incident assigned to you: Hydraulic leak on Press 7".

## 2. The technician's assistant does the work

Tess connects her MCP client to the organization and grants it
`ontology:read actions:apply`. Its tools include `action_close_incident` and
`action_create_maintenance_order`, but not `action_assign_incident`:
technicians are not granted it.

Asked for every incident (`query_objects` on `incident`, no filter), the
assistant gets one: the leak. The belt squeal exists, but it is not assigned
to Tess, so to her it does not. It narrows the query anyway (`whoami` gives
her id):

```json
{ "tool": "query_objects",
  "arguments": { "type": "incident", "filter": { "op": "and", "filters": [
    { "op": "eq", "property": "assignee", "value": "<tess>" },
    { "op": "eq", "property": "status", "value": "assigned" } ] } } }
```

It gets the leak at version 2, finds its machine by following the link
(`query_objects` on `machine` with `{"op": "linked", "link": "incidents",
"object": "<incident>"}`), and calls `list_actions`: `close_incident` and
`create_maintenance_order`.

**Denied.** Asked to reassign the incident, it tries anyway:

```json
{ "tool": "action_assign_incident",
  "arguments": { "incident": "<incident>", "team": "<technicians team>", "assignee": "<tess>" } }

→ error { "code": "forbidden" }
```

**Applied.** It opens a work order, stating the version it read:

```json
{ "tool": "action_create_maintenance_order",
  "arguments": { "incident": "<incident>", "machine": "<press 7>",
                 "summary": "Replace the main cylinder seal", "priority": "urgent",
                 "idempotency_key": "order-1",
                 "expected_versions": { "incident": 2 } } }

→ { "application_id": "<a2>", "applied_by": { "kind": "human", "via": "mcp", ... },
    "created": [{ "type": "work_order", "ref": "order", ... }],
    "links": [ ... 2 created ... ],
    "updated": [{ "type": "incident", "version": 3, ... }, { "type": "machine", ... }] }
```

The work order, both links, the incident's new status, and the machine's
new status commit together. Retrying with the same key returns the same work
order (`replayed: true`).

**Conflict.** Next it submits the close, still stating version 2. The work
order moved the incident to version 3, so nothing is applied:

```json
{ "tool": "action_close_incident",
  "arguments": { "incident": "<incident>",
                 "resolution": "Seal replaced, pressure test passed",
                 "expected_versions": { "incident": 2 } } }

→ error { "code": "version_conflict",
          "details": [{ "path": "params.incident", "message": "..." }] }
```

It reads the incident again (`get_object`: version 3, `in_progress`) and
submits with version 3. The incident is high severity and has no close
request yet, so the edits set it to `awaiting_approval` with
`close_requested_by` = Tess and the resolution.

**Refused by a criterion.** Asked to finish the job, it tries to approve the
close itself:

```json
→ error { "code": "criteria_failed",
          "details": [{ "path": "criteria.four_eyes",
                        "message": "a high-severity incident needs approval by someone other than whoever submitted it" }] }
```

## 3. The supervisor approves

Sam's app has been following the [event stream](/docs/api/events/) all
along, so the incident awaiting approval is already on screen. Sam approves
over REST with a session token:

```http
POST /v1/actions/close_incident/apply
{ "params": { "incident": "<incident>" } }

201 { "updated": [{ "type": "incident", "version": 5, ... }], ... }
```

The incident now reads `status: closed`, `close_requested_by` = Tess,
`approved_by` = Sam, and Tess's resolution. Its `work_orders` link leads to
the work order, and Press 7 is in `maintenance`.

## What everyone saw

Sam's event stream carried every change, whoever made it and however they
connected: the `object.created`, `object.updated`, and `link.created` events
of each edit, and four `action.applied` events:

| Action | Via |
|---|---|
| `assign_incident` | `rest` (dispatch-bot) |
| `create_maintenance_order` | `mcp` (Tess) |
| `close_incident` (submit) | `mcp` (Tess) |
| `close_incident` (approve) | `rest` (Sam) |

The refused calls appear nowhere: they changed nothing.

The audit log (`GET /v1/action-applications`, newest first) records how
each application was authenticated:

| Action | Method | Kind |
|---|---|---|
| `close_incident` | `session` | `human` |
| `close_incident` | `oauth` | `human` |
| `create_maintenance_order` | `oauth` | `human` |
| `assign_incident` | `api_token` | `agent` |

After commit, the background job delivered the effects: Tess got the
assignment email and two "close_incident applied" emails. The work order's
webhook went to `hooks.example.com`, which does not accept it, so its effect
stays `pending`, and `GET /v1/action-applications/<a2>` shows its attempts,
last error, and next attempt.

## What this shows

- **Agents get named operations, not write access.** Technicians hold no
  write permission. The rules for what a work order means and who may close
  an incident live in the action, not in each client.
- **Denials and conflicts are explicit.** `forbidden` for an action you are
  not granted, `version_conflict` with the parameter that moved,
  `criteria_failed` with the criterion and its message. In each case nothing
  is written.
- **Retries are safe.** An idempotency key turns a lost answer into a
  replay, not a second work order.
- **People and agents see the same objects.** The supervisor's app, the
  technician's assistant, and the agent read and change one incident.
- **Each sees only what is theirs.** The technician's assistant sees the
  incidents assigned to her and nothing else, enforced by the database, not
  by the client.
