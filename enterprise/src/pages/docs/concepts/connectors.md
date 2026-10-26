---
layout: ../../../layouts/Docs.astro
title: Connectors
lead: An organization connects outside MCP servers, such as a git host or a ticket system, and its people and agents call their tools through the organization's own MCP endpoint. Each tool is reviewed before anyone sees it, granted to teams with limits on its arguments, and every call is checked and logged.
---

A **connector** is a remote MCP server the organization registers once.
Its tools then appear on the organization's
[MCP endpoint](/docs/concepts/mcp/) as `<connector>.<tool>`, such as
`git.read_file`, to exactly the people and agents allowed to call them.
Clients never talk to the remote themselves and never hold its
credential: Happy Enterprise makes every call, after checking who may make
it and with which arguments.

Registering, reviewing, and granting connectors needs the
`manage_connectors` permission; see the [API](/docs/api/connectors/).

## Registering a connector

A connector has a `name` (`[a-z][a-z0-9_]{0,31}`), which prefixes its
tools, a display name, the remote's URL, and a transport:

- `streamable_http` (the default): MCP's Streamable HTTP.
- `sse`: the older HTTP with server-sent events transport. Its message
  endpoint must be on the connector's own origin.

It authenticates at the remote in one of four ways:

| `auth.kind` | Sends |
|---|---|
| `none` | nothing |
| `bearer` | `Authorization: Bearer <token>` |
| `header` | any other header, such as an API key header |
| `oauth` | an OAuth 2.1 access token, refreshed when it expires or is refused |

For OAuth, the remote's authorization server is discovered from the
connector's URL unless its endpoints are given, and Happy Enterprise
registers itself as a client if no client id is given and the server
allows it. An admin then opens the authorization URL in a browser,
consents at the remote, and is sent back to the organization, with PKCE
and a single-use state that expires after 10 minutes.

**Secrets are never returned.** Tokens, header values, client secrets,
and OAuth tokens are encrypted at rest with the server's key, and the API
shows only whether a connector has one. Moving a connector's URL to
another origin needs its credential again, so a stored secret never
follows the URL somewhere else. Deleting a connector removes its tools at
once and keeps its call log.

## Reviewing the catalog

Tool descriptions and schemas are text that reaches language models, so
nothing a remote lists is served until an admin has read it.

- **Sync** lists the remote's tools, resources, and prompts, each with its
  exact definition (name, title, description, input and output schemas,
  annotations) and a hash of it. The catalog is versioned: each item
  records the version it first appeared in and the version it last
  changed in.
- **New tools start `pending`.** An admin reads the definition and enables
  the tool by naming its `hash`. A hash that is no longer current is
  `409`: the admin reviews again.
- **Members see only the reviewed text.** What is served is the definition
  the admin approved, never what the remote sends later.
- **A changed tool goes back to `pending`.** If a sync finds that an
  enabled tool's definition changed, or that the remote no longer lists
  it, the tool stops being served until it is reviewed and enabled again.
  The database refuses an enabled tool without a reviewed definition.
- Each tool is marked `read` or `write`, which decides the scope a call
  needs.

## Granting tools to teams

An enabled tool is called by the teams it is granted to, and by the
members of their subteams; organization owners need no grant. Each grant
may limit the tool's arguments:

```json
PUT /v1/connectors/git/tools/read_file/grants
{ "grants": [
    { "team": "<agents>", "arguments": { "repo": { "allow": ["api", "docs"] } } },
    { "team": "<maintainers>" } ] }
```

| Policy | Means |
|---|---|
| `{"pin": value}` | the argument is always this value: it is filled in, and any other value is refused |
| `{"allow": [values]}` | the argument must be given, and be one of these values |

With several grants, a call goes through the first one whose policy
accepts it. The input schema a caller sees is narrowed to match when all
of their grants for the tool have the same policy: pinned arguments are
removed, and allowed ones become an `enum`.

## Who sees and calls a tool

A tool is listed on the MCP endpoint, and a call of it is accepted, exactly
when:

- the connector is live and the tool is enabled;
- it is granted to one of the caller's teams, or the caller is an owner;
- the credential's scopes allow it: `connectors:use` for read tools, and
  `connectors:write` too for write tools.

So `tools/list` never shows a tool a call would refuse. `GET
/v1/connector-tools` shows the same list over REST. Nothing a remote sends
changes grants, reviews, or access.

## Calls

| Limit | |
|---|---|
| Calls | 120 a minute per user, through MCP |
| Arguments | 256 KiB |
| Time | 30 seconds for the remote to answer |
| Response | 4 MiB |

**Results are marked as external.** The remote's answer goes back after a
line saying it is external content from the connector tool: data from
outside the organization, not instructions. Served tool descriptions are
labelled the same way, so a model can tell the remote's words from the
organization's.

**Every call is logged**, refusals included: the tool, the user, the
credential (and the MCP token, if one was used), whether it came through
MCP or an action, the arguments with secret-looking values redacted, the
outcome (`ok`, `tool_error`, `denied`, `rate_limited`, or `failed`), the
duration, and the sizes. Admins read the log per connector.

The proxy adds little: about 3 ms per call in a test that ran the server
and the remote in one process.

## From actions

An [action](/docs/concepts/actions/#effects) can call a connector tool as
an effect, after it commits:

```json
{ "kind": "connector", "tool": "git.comment",
  "arguments": { "repo": "api", "issue": "{{param.issue}}", "text": "Fixed by {{caller.id}}" } }
```

- **Checked twice.** Applying the action checks that the person applying
  it may make this call now, with these arguments, and refuses the
  application otherwise. The background job checks again when it delivers
  the effect, as that person.
- **Called once.** The effect's id goes to the remote as an idempotency key
  (`_meta["io.happy-enterprise/idempotency-key"]`), and once the remote has
  answered, the call is never made again.
- Arguments use the same placeholders as emails; a string that is exactly
  one placeholder becomes its value as is, a number say.

## Network safety

Connectors reach only addresses that are safe to reach from the server:

- **HTTPS only.** `CONNECTORS_ALLOW_HTTP` allows `http` for development.
- **Public addresses only.** A host is resolved once per request. If any
  of its addresses is loopback, private, link-local (cloud metadata
  addresses included), shared, documentation, multicast, or unspecified,
  the request is refused, unless the operator lists it in
  `CONNECTORS_ALLOW_ADDRESSES`. The connection then goes to the address
  that was checked, never to a second DNS answer.
- **Redirects are checked.** At most 3, each one checked the same way; one
  that leaves the origin drops the credential.

See [Configuration](/docs/self-hosting/configuration/#connectors).

## Not there yet

- **One identity at the remote.** The credential is the organization's, so
  every call goes out as the same remote user, whoever made it. The log
  records who made each call.
- **Resources and prompts are listed for review but not served.**
- **No live events for calls.** The call log is read on request.
- **No scope per connector.** `connectors:use` and `connectors:write`
  cover every connector tool granted to the user.
- **Narrowed schemas need matching grants.** A caller whose grants for a
  tool have different policies sees the reviewed schema; their calls are
  still checked against the grants.
