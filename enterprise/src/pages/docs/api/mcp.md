---
layout: ../../../layouts/Docs.astro
title: MCP tools
lead: The MCP endpoint of an organization, the tools it offers, and the scopes and permissions each one needs.
---

Each organization has its own MCP server. Clients reach it with an access
token from the organization's [OAuth server](/docs/api/oauth/); see
[MCP and OAuth](/docs/concepts/mcp/) for the flow.

## The endpoint

### POST /orgs/{org}/mcp

<p class="ep-meta"><span><b>Auth</b>OAuth access token</span><span><b>Permission</b>per tool</span></p>

MCP over Streamable HTTP: stateless (no `Mcp-Session-Id`), JSON responses
rather than event streams. Send `Authorization: Bearer <access token>`.

```sh
curl "$BASE/orgs/$ORG/mcp" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"whoami","arguments":{}}}'
```

The token must be an access token (`aud = "happy-enterprise:mcp"`) of a full
`oauth` session of the organization in the path. Anything else, including a
missing token, a REST session token, or a token of another organization, gets
`401`:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/orgs/c8kq2m7xw3n5p9r1t4v6y0za/mcp", scope="mcp:read mcp:invite ontology:read ontology:write", error="invalid_token"

{"error":{"code":"unauthorized","message":"unauthorized"}}
```

`error="invalid_token"` is present only when a token was sent. The `Host`
header must be one of `MCP_ALLOWED_HOSTS` (by default the host of
`PUBLIC_BASE_URL`), against DNS rebinding.

The server identifies itself as `happy-enterprise`. Its instructions tell the
client it offers the organization's members, teams, invites, and ontology
(object types, objects, links), and the actions the user may apply, one tool
each (`action_<name>`).

## Scopes

| Scope | Allows | Permission it is intersected with |
|---|---|---|
| `mcp:read` | `list_members`, `list_teams` (the default scope) | `view_members` for members |
| `mcp:invite` | `invite_member` | `invite_members` |
| `ontology:read` | `describe_schema`, `query_objects`, `get_object`, `query_timeseries`, `latest_points` | `view_objects` (on the type) |
| `ontology:write` | `create_object`, `update_object`, `write_points`, with `ontology:read` | `edit_objects` (on the type) |
| `actions:apply` | `action_<api_name>` tools, with `ontology:read` for the types they touch | the action's grant (no permission on its own) |

A tool runs only if both the grant's scopes and the user's own permissions
allow it, checked again in a fresh transaction on every call. Losing a
permission or having the grant revoked takes effect on the next call. No
scope reaches owner-only actions, the security posture, organization
settings, or the ontology's schema.

## Results and errors

A successful call returns one text content block holding JSON. A refused
call is a tool result with `isError: true`. The ontology tools carry the REST
API's error, `details` included:

```json
{
  "content": [{ "type": "text",
    "text": "{\"error\":{\"code\":\"validation_failed\",\"message\":\"the properties do not satisfy the object type\",\"details\":[{\"path\":\"email\",\"message\":\"must be an email address\"}]}}" }],
  "isError": true
}
```

A missing permission or scope is `forbidden` ("this needs a permission you
lack, or a scope the grant lacks"); a restricted type you cannot view is
`not_found`. Internal failures are JSON-RPC errors, not tool results.

## Tools

### whoami

<p class="ep-meta"><span><b>Scope</b>any</span><span><b>Permission</b>none</span></p>

Who the token acts for. No arguments.

```json
{
  "user": { "id": "h3jd8s0q2l5x7c1v9b4n6m8k", "kind": "human", "display_name": "Ada Lovelace", "...": "..." },
  "org": { "id": "c8kq2m7xw3n5p9r1t4v6y0za", "name": "Acme" },
  "permissions": ["view_members", "view_objects", "edit_objects"],
  "scopes": ["mcp:read", "ontology:read", "ontology:write"]
}
```

`permissions` are the effective ones: what the user holds, cut down to what
the scopes allow.

### list_members

<p class="ep-meta"><span><b>Scope</b>mcp:read</span><span><b>Permission</b>view_members</span></p>

No arguments. `{"members": [...]}`, every member of the organization as a
[user object](/docs/api/me/#the-user-object), oldest first.

### list_teams

<p class="ep-meta"><span><b>Scope</b>mcp:read</span><span><b>Permission</b>none</span></p>

No arguments. `{"teams": [...]}`, as [`GET /v1/teams`](/docs/api/teams/#get-v1-teams).

### invite_member

<p class="ep-meta"><span><b>Scope</b>mcp:invite</span><span><b>Permission</b>invite_members</span></p>

```json
{ "email": "grace@example.com" }
```

Sends an invite as [`POST /v1/invites`](/docs/api/members/#post-v1-invites)
does, and returns:

```json
{ "id": "i5n1v7i3t9e2x6c0q4w8r2t6", "email": "grace@example.com", "expires_at": "2026-10-31T10:00:00Z" }
```

### describe_schema

<p class="ep-meta"><span><b>Scope</b>ontology:read</span><span><b>Permission</b>view_objects</span></p>

No arguments. `{"object_types": [...], "link_types": [...]}`: the types you
may view, with their properties and rules, as
[`GET /v1/ontology`](/docs/api/ontology-schema/) returns them. Link types to
types you cannot view are left out.

### query_objects

<p class="ep-meta"><span><b>Scope</b>ontology:read</span><span><b>Permission</b>view_objects on the type</span></p>

| Argument | |
|---|---|
| `type` | object type `api_name` (required) |
| `filter` | a filter tree, as in [queries](/docs/api/ontology-objects/#post-v1-ontology-objects-type-query) |
| `order_by` | `{"property": "<name, $id, $created_at, or $updated_at>", "direction": "asc" \| "desc"}` |
| `limit` | 1-500, default 50 |
| `cursor` | `next_cursor` of the previous page |

```json
{
  "type": "employee",
  "filter": { "op": "and", "filters": [
    { "op": "eq", "property": "team", "value": "platform" },
    { "op": "gte", "property": "started", "value": "2026-01-01" }
  ] },
  "order_by": { "property": "started", "direction": "desc" },
  "limit": 20
}
```

Returns a page, `{"data": [...], "next_cursor": ...}`, of
[objects](/docs/api/ontology-objects/#the-object).

### get_object

<p class="ep-meta"><span><b>Scope</b>ontology:read</span><span><b>Permission</b>view_objects on the type</span></p>

```json
{ "type": "employee", "id": "o4b8j2e6c0t1q5w9r3y7u2i6" }
```

The object, or `not_found`.

### create_object

<p class="ep-meta"><span><b>Scope</b>ontology:read + ontology:write</span><span><b>Permission</b>view_objects + edit_objects on the type</span></p>

```json
{ "type": "employee", "properties": { "name": "Grace", "email": "grace@acme.example" } }
```

The new object. The properties are checked against the type's definition,
format rules, and [custom validators](/docs/concepts/validators/), exactly
as over REST, and the write emits an `object.created`
[event](/docs/concepts/live-events/).

### update_object

<p class="ep-meta"><span><b>Scope</b>ontology:read + ontology:write</span><span><b>Permission</b>view_objects + edit_objects on the type</span></p>

```json
{
  "type": "employee",
  "id": "o4b8j2e6c0t1q5w9r3y7u2i6",
  "properties": { "team": "research", "nickname": null },
  "expected_version": 3
}
```

`properties` are merged into the stored ones; `null` removes a property. The
result must satisfy the type. With `expected_version`, the change is refused
(`conflict`) unless the object is at that version. Returns the updated
object.

### query_timeseries

<p class="ep-meta"><span><b>Scope</b>ontology:read</span><span><b>Permission</b>view_objects + a view of the series</span></p>

`type`, the timeseries type's `api_name`, plus the body of
[`POST .../query`](/docs/api/timeseries/#post-v1-ontology-timeseries-type-query):

```json
{ "type": "telemetry", "object": "o4b8j2e6c0t1q5w9r3y7u2i6", "fields": ["temperature"],
  "from": "2026-10-26T08:00:00Z", "to": "2026-10-26T09:00:00Z", "max_points": 60 }
```

Returns raw points or buckets, as the REST endpoint does.

### latest_points

<p class="ep-meta"><span><b>Scope</b>ontology:read</span><span><b>Permission</b>view_objects + a view of the series</span></p>

`type` plus the body of
[`POST .../latest`](/docs/api/timeseries/#post-v1-ontology-timeseries-type-latest):
a selection and `fields`. Returns each series with its newest point.

### write_points

<p class="ep-meta"><span><b>Scope</b>ontology:read + ontology:write</span><span><b>Permission</b>view_objects + edit_objects on the timeseries type, and a view of each object</span></p>

```json
{ "type": "telemetry", "idempotency_key": "mcp-saw-0900",
  "series": [ { "object": "o4b8j2e6c0t1q5w9r3y7u2i6", "tags": { "sensor": "spindle" },
                "points": [ { "at": "2026-10-26T09:00:00Z", "values": { "temperature": 41.5 } } ] } ] }
```

Writes a batch as
[`POST .../points`](/docs/api/timeseries/#post-v1-ontology-timeseries-type-points)
does, at most 10,000 points, and returns its result; the ingest log records
it with `via: mcp`.

### list_actions

<p class="ep-meta"><span><b>Scope</b>ontology:read + actions:apply</span><span><b>Permission</b>the actions' grants</span></p>

The [actions](/docs/concepts/actions/) you may apply, each with a JSON Schema
of its parameters, as in [`GET /v1/actions`](/docs/api/actions/#get-v1-actions).

### action_&lt;api_name&gt;

<p class="ep-meta"><span><b>Scope</b>ontology:read + actions:apply</span><span><b>Permission</b>the action's grant + view access to every type it touches</span></p>

One tool per action you may apply, named after it, such as
`action_open_work_order`. Its input schema is the action's parameters plus
`idempotency_key` and `expected_versions`, and its description ends with the
action's name and version:

```json
{
  "incident": "o4b8j2e6c0t1q5w9r3y7u2i6",
  "summary": "Replace the seal",
  "idempotency_key": "mcp-triage-42",
  "expected_versions": { "incident": 3 }
}
```

The tool applies the action exactly as
[`POST /v1/actions/{type}/apply`](/docs/api/actions/#post-v1-actions-type-apply)
does and returns its result, with `applied_by.via` set to `mcp`. Refusals
are tool errors carrying the REST error, such as `criteria_failed` or
`version_conflict`.

