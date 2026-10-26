---
layout: ../../../layouts/Docs.astro
title: MCP and OAuth
lead: Every organization has its own MCP server and its own OAuth 2.1 authorization server. An assistant acts for a signed-in user, or an agent with an MCP token, limited to both the scopes it was given and the user's own permissions.
---

## The endpoint

```text
<PUBLIC_BASE_URL>/orgs/{org}/mcp
```

The server speaks MCP over Streamable HTTP, stateless, with JSON responses. It
is built on [rmcp](https://github.com/modelcontextprotocol/rust-sdk) and
follows the MCP authorization spec, so a compliant client needs only the URL:

1. It calls the endpoint without a token and gets `401` with
   `WWW-Authenticate: Bearer resource_metadata="<url>"`.
2. It reads the protected resource metadata (RFC 9728), then the
   organization's authorization server metadata (RFC 8414). The issuer is
   `<PUBLIC_BASE_URL>/orgs/{org}`.
3. It registers itself (RFC 7591 dynamic client registration).
4. It opens the browser at the authorization endpoint with PKCE `S256`.
5. The user signs in on the organization's pages and consents.
6. The client exchanges the code for tokens and calls the MCP endpoint.

The [OAuth endpoints](/docs/api/oauth/) page lists every route. Clients
that cannot sign in through a browser, such as agent accounts and scripts,
use an [MCP token](#mcp-tokens) instead.

## Scopes and tools

| Scope | Grants | Tools |
|---|---|---|
| `mcp:read` (the default) | `view_members`, listing teams | `whoami`, `list_members`, `list_teams` |
| `mcp:invite` | `invite_members` | `invite_member` |
| `ontology:read` | `view_objects` | `describe_schema`, `query_objects`, `get_object`, `query_timeseries`, `latest_points` |
| `ontology:write` | `edit_objects` (writing needs `ontology:read` too) | `create_object`, `update_object`, `write_points` |
| `chat:read` | `view_objects`, on chat types only | `list_channels`, `read_messages` |
| `chat:write` | `edit_objects`, on chat types only (with `chat:read`) | `post_message`, `add_reaction` |
| `files:read` | `view_objects`, on filesystem types only | `list_files`, `read_file`, `search_files` |
| `files:write` | `edit_objects`, on filesystem types only (with `files:read`) | `write_file`, `make_folder`, `move_file`, `delete_file` |
| `ontology:read`, `chat:read`, `files:read` | each lets `search` look through its kind: objects, messages, files | `search` |
| `connectors:use` | calling the [connector](/docs/concepts/connectors/) tools granted to the user that are marked `read` | `<connector>.<tool>` |
| `connectors:write` | also the granted tools marked `write` (with `connectors:use`) | `<connector>.<tool>` |
| `actions:apply` | no permission on its own: the user's [action](/docs/concepts/actions/) grants, with `ontology:read` for the types each action touches | `list_actions`, one `action_<api_name>` tool per action |

A tool's permission must be allowed by **both** the grant's scopes and the
user's own permissions, and both are checked again on every call, so a user
who loses a permission loses it in their agents too. No scope reaches
owner-only actions, the security posture, organization settings, or the
ontology's schema.

The ontology tools run the same functions as the REST API: the same
restricted-type access, value checks, custom validators, and live events.
The [timeseries](/docs/concepts/timeseries/) tools read and write series
under the same rules as their REST endpoints. [Chat](/docs/concepts/chat/)
has scopes of its own: `ontology:read` and `ontology:write` do not reach
chat, and `chat:read` and `chat:write` reach nothing else, so a grant to
read incidents does not read their channels, and the other way around.
[Filesystems](/docs/concepts/filesystem/) are the same: `files:read` and
`files:write` reach only filesystem types, and no other scope reaches
them. File tools are held to the `write` level, so assistants never change
who may use a folder. [Connector](/docs/concepts/connectors/) tools are listed
only to those granted them, under `connectors:use` (and `connectors:write`
for write tools), and their results are marked as content from outside the
organization. The [search](/docs/concepts/search/) tool looks
through each kind only with its read scope, so a grant of `chat:read`
alone searches messages and nothing else. A refused call is a tool error (`isError: true`) whose text is the REST error:

```json
{ "error": { "code": "validation_failed", "message": "the properties do not satisfy the object type",
  "details": [{ "path": "email", "message": "must be an email address" }] } }
```

See [MCP tools and scopes](/docs/api/mcp/) for each tool's arguments.

## Signing in

The authorization endpoint does not render a login form directly: it records
the request and redirects to a request page,
`/orgs/{org}/oauth/requests/{request}`, which walks the user through:

1. **Email code.** The same codes and eligibility rules as the REST login.
2. **Second factor.** If the organization requires 2FA: verify an existing
   factor, or, for a user with none, enroll a security key, passkey, or
   authenticator app right there.
3. **Consent.** The client's name, redirect URI, and requested scopes.

A request continues only in the browser that started it (an `HttpOnly`,
`SameSite=Lax` cookie) and expires after 30 minutes. The pages send a
nonce-based Content Security Policy, `X-Frame-Options: DENY`, and
`Cache-Control: no-store`.

## MCP tokens

An **MCP token** is a long-lived credential for the MCP endpoint, with the
same scopes an OAuth grant has, for clients that cannot go through a
browser sign-in:

- **Personal tokens.** Any member issues tokens for themselves, to use with
  a script or a client of their own.
- **Agent tokens.** Owners issue tokens for [agent accounts](/docs/concepts/organizations/),
  so agents use MCP tools, connector tools included, as themselves.

A token looks like `hemt_<org>_<token id>_<secret>`.

- **MCP only.** It works at its organization's MCP endpoint and nowhere
  else: the REST API refuses it.
- **Scoped.** It reaches what its user may do, intersected with its scopes,
  checked on every call like an OAuth grant. Being scoped, it never reaches
  owner-only or manage-level operations, an owner's token included.
- **Optional expiry**, 1 to 3,650 days.
- **Shown once.** The secret is in the response that creates it, and only
  a hash of it is stored.
- **Revoked and rotated.** A revoked or expired token authenticates
  nothing. Rotating issues a new token with the same name, scopes, and
  expiry, and revokes the old one at once.
- **Managed by people.** Tokens are issued, listed, revoked, and rotated
  with a session or an API token, never with another MCP token.
- **Second factors.** Where the organization requires two-factor
  authentication, a person's token works only if it was issued from a
  session that completed a second factor.

Calls, action applications, and connector calls made with a token record
`mcp_token` as the credential, as the token's user. See the
[token endpoints](/docs/api/mcp/#mcp-tokens).

## Codes, grants, and tokens

- **Authorization codes** live 120 seconds. Any presentation consumes a code,
  and presenting a consumed one revokes the grant it produced. The exchange
  needs the same client and redirect URI, and the PKCE verifier.
- A **grant** is an `oauth` session (30 days) that holds its client and
  scopes.
- **Access tokens** are session tokens with `aud = "happy-enterprise:mcp"` and
  a 1-hour lifetime. They work only at their own organization's MCP endpoint,
  never on the REST API.
- **Refresh tokens** `her_<session>_<secret>` rotate on every use. Reusing a
  rotated-out one revokes the grant.
- **Revocation** (RFC 7009) of a refresh or access token ends the whole
  grant, if presented by the grant's client. Users see and end their grants
  with `/v1/me/sessions`; owners end all of a member's grants with
  `DELETE /v1/members/{user}/sessions`.
- Deactivation and the 2FA requirement apply to grants as to any session.

## Clients

Clients are public (`token_endpoint_auth_method = none`), so PKCE is what binds
a code to the client that asked for it. Allowed redirect URIs are `https`,
loopback `http` (any port at use, as native apps need), or a custom scheme.
An organization can have at most 500 registered clients.

## Browsers and hosts

- **CORS.** Discovery, registration, token, revocation, and the MCP endpoint
  allow any origin without credentials, since they use bearer tokens and form
  fields rather than cookies, and expose `WWW-Authenticate`. The sign-in pages
  and the REST API send no CORS headers.
- **DNS rebinding.** The MCP endpoint checks `Host` against
  `MCP_ALLOWED_HOSTS` (by default, the host of `PUBLIC_BASE_URL`).
- **Unknown organizations** get metadata and registration responses like real
  ones, but no client works there.

## Guarantees

- A credential works at one organization's MCP endpoint only.
- MCP tokens never work on the REST API, and never reach manage-level or
  owner-only operations.
- Tools never exceed the grant's scopes or the user's current permissions.
- Authorization codes and refresh tokens are single-use and bound to their
  client; replaying a used code or a rotated-out refresh token revokes the
  grant.
- Revocation sticks: none of a revoked grant's tokens work afterwards.
