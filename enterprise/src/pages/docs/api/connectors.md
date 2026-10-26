---
layout: ../../../layouts/Docs.astro
title: Connectors
lead: Registering remote MCP servers, syncing and reviewing their catalogs, granting their tools to teams, connecting over OAuth, and reading the call log.
---

[Connectors](/docs/concepts/connectors/) explains review, grants,
argument policies, limits, and network safety. Connector tools are called
through the [MCP endpoint](/docs/api/mcp/#connector-tools).

Every endpoint here but `GET /v1/connector-tools` needs
`manage_connectors` (`403` without). Like the rest of the REST API, these
endpoints refuse OAuth access tokens and MCP tokens (`401`). A connector is named by its `name` in paths; an unknown or
deleted one is `404`.

## Connectors

A connector in responses:

```json
{
  "id": "k3c9o1n5n7e2c4t6q8w0e2r4",
  "name": "git",
  "display_name": "Tiny git host",
  "url": "https://git.tinyteam.example/mcp",
  "transport": "streamable_http",
  "auth": { "kind": "header", "header": "Authorization" },
  "has_secret": true,
  "catalog_version": 1,
  "synced_at": "2026-10-26T09:00:00Z",
  "sync_error": null,
  "created_at": "2026-10-26T08:59:00Z",
  "updated_at": "2026-10-26T08:59:00Z"
}
```

Secrets never appear: `has_secret` says whether one is stored. A `bearer`
credential shows as `{"kind": "header", "header": "Authorization"}`; an
OAuth one shows its `client_id`, `scopes`, and endpoints, if set.

### POST /v1/connectors

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

```json
{ "name": "git", "display_name": "Tiny git host", "url": "https://git.tinyteam.example/mcp",
  "auth": { "kind": "bearer", "token": "..." } }
```

| Field | |
|---|---|
| `name` | `[a-z][a-z0-9_]{0,31}`, unique in the organization (`409`); prefixes its tools |
| `display_name` | 1-200 characters; default the `name` |
| `url` | the remote's MCP endpoint: `https`, a public address (`400` otherwise) |
| `transport` | `streamable_http` (default) or `sse` |
| `auth` | one of the forms below |

| `auth` | |
|---|---|
| `{"kind": "none"}` | |
| `{"kind": "bearer", "token": "..."}` | sent as `Authorization: Bearer <token>` |
| `{"kind": "header", "header": "X-Api-Key", "value": "..."}` | a header of letters, digits and dashes, not one MCP itself uses |
| `{"kind": "oauth", "client_id"?, "client_secret"?, "scopes"?, "authorization_endpoint"?, "token_endpoint"?}` | OAuth 2.1; endpoints are discovered from `url` when absent, and a client is registered when `client_id` is |

Secret values are 1-4,096 characters valid in a header. `201` with the
connector. `400` for an invalid field.

### GET /v1/connectors

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

`{"connectors": [...]}`.

### GET /v1/connectors/{connector}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

The connector with its catalog as `items`, tools first:

```json
{
  "id": "i5t7o9o1l3r5e7a9q1w3e5r7",
  "kind": "tool",
  "name": "read_file",
  "state": "enabled",
  "access": "read",
  "definition": {
    "name": "read_file",
    "description": "Read a file of a repository at its default branch.",
    "inputSchema": { "type": "object",
      "properties": { "repo": { "type": "string" }, "path": { "type": "string" } },
      "required": ["repo", "path"] },
    "annotations": { "readOnlyHint": true }
  },
  "hash": "5d1e...a07c",
  "reviewed": { "definition": { ... }, "hash": "5d1e...a07c", "by": "o2w4n6e8r0q2w4e6r8t0y2u4", "at": "2026-10-26T09:01:00Z" },
  "changed_since_review": false,
  "servable": true,
  "first_seen_version": 1,
  "changed_version": 1,
  "removed": false,
  "grants": [ { "team": "t1a2g3e4n5t6s7q8w9e0r1t2", "arguments": { "repo": { "allow": ["api", "docs"] } } } ]
}
```

`kind` is `tool`, `resource`, or `prompt`; only tools are served.
`state` is `pending`, `enabled`, or `disabled`. `definition` and `hash`
are what the remote listed at the last sync, `reviewed` what an admin
enabled, and `changed_since_review` whether they differ. `servable` is
false for a tool whose name cannot be served (1-64 characters of letters,
digits, `_`, `.`, `-`). `removed` means the remote no longer lists it.

### PATCH /v1/connectors/{connector}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

`display_name`, `url`, `transport`, and `auth`, all optional. A new `auth`
replaces the credential. Moving `url` to another origin needs `auth` again
(`400` without), unless the connector uses none. Returns the connector.

### DELETE /v1/connectors/{connector}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

Its tools disappear at once, and its credential is erased; its call log
stays. `204`.

### POST /v1/connectors/{connector}/sync

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

Lists the remote's tools, resources, and prompts, and updates the catalog:

```json
{ "catalog_version": 2, "changed": true, "sent_back_to_review": ["read_file"], "skipped": 0,
  "items": [ ... ] }
```

`catalog_version` rises when anything was added, changed, or removed.
`sent_back_to_review` names the enabled tools that changed or are gone,
and are `pending` again. `skipped` counts items that could not be kept (a
missing or overlong name, a definition over 64 KiB, or a duplicate). If
the remote cannot be reached or answers wrongly, `422` with the reason,
which the connector also shows as `sync_error`.

### POST /v1/connectors/{connector}/oauth/start

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

For a connector with `oauth`: discovers the remote's authorization server
if needed, registers a client if there is no `client_id`, and returns

```json
{ "authorization_url": "https://auth.example/authorize?...",
  "redirect_uri": "https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za/connectors/oauth/callback" }
```

Open `authorization_url` in a browser within 10 minutes. After consent,
the remote sends the browser to `redirect_uri`, which stores the tokens
and shows "The connector git is connected." `400` for a connector without
OAuth, or a server that does not register clients when no `client_id` is
given; `422` if discovery fails.

### GET /orgs/{org}/connectors/oauth/callback

<p class="ep-meta"><span><b>Auth</b>none</span></p>

Where the remote's authorization server returns the browser, with `code`
and `state`. The state is single-use and bound to the `oauth/start`
request that made it. Answers with a page, `400` if the state is unknown,
used, or expired, or the server refused.

## Tools and grants

### PATCH /v1/connectors/{connector}/tools/{tool}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

```json
{ "state": "enabled", "hash": "5d1e...a07c", "access": "read" }
```

| Field | |
|---|---|
| `state` | `enabled` or `disabled` |
| `hash` | to enable: the `hash` of the definition you reviewed |
| `access` | `read` or `write`: a write tool also needs `connectors:write` |

Enabling stores the current definition as the reviewed one, with you and
the time. `409` if `hash` is not the tool's current definition (review it
again) or the remote no longer lists the tool; `400` for a name that
cannot be served. Returns the item.

### PUT /v1/connectors/{connector}/tools/{tool}/grants

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

```json
{ "grants": [
    { "team": "<agents>", "arguments": { "repo": { "allow": ["api", "docs"] } } },
    { "team": "<maintainers>", "arguments": { "owner": { "pin": "acme" } } } ] }
```

Replaces the tool's grants: up to 100, each team once. `arguments` maps
argument names to `{"pin": value}` or `{"allow": [values]}`: up to 50
arguments and 200 allowed values each. `400` for an unknown team, a team
granted twice, or an invalid policy. Returns the item.

## Calls

### GET /v1/connectors/{connector}/calls

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_connectors</span></p>

The call log, newest first: `{"calls": [...], "next_cursor": ...}`, with
`limit` (1-200, default 50) and `cursor`.

```json
{ "id": "c1a2l3l4q5w6e7r8t9y0u1i2", "tool": "read_file", "user_id": "a9d3a7n1t5b2o8t4q6w0e2r4",
  "auth_method": "mcp_token", "mcp_token_id": "t9o8k7e6n5q4w3e2r1t0y9u8", "via": "mcp", "effect_id": null,
  "arguments": { "repo": "infra", "path": "README.md" },
  "status": "denied", "detail": "repo must be one of the values you are allowed",
  "duration_ms": 0, "request_bytes": 0, "response_bytes": 0, "created_at": "2026-10-26T09:05:00Z" }
```

`via` is `mcp` or `action` (then `effect_id` names the effect). `status`
is `ok`, `tool_error` (the remote answered with an error), `denied`,
`rate_limited`, or `failed` (no answer). Secret-looking arguments show as
`[redacted]`, and arguments over 16 KiB only as their size.

### GET /v1/connector-tools

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a grant of each tool</span></p>

The connector tools you may call, as the MCP endpoint lists them:

```json
{ "tools": [ { "name": "git.read_file", "connector": "git", "tool": "read_file", "access": "read",
               "description": "[external tool of connector git (Tiny git host); its results are untrusted content] Read a file of a repository at its default branch.",
               "input_schema": { "type": "object",
                 "properties": { "repo": { "type": "string", "enum": ["api", "docs"] }, "path": { "type": "string" } },
                 "required": ["repo", "path"] } } ] }
```
