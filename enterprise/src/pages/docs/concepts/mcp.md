---
layout: ../../../layouts/Docs.astro
title: MCP and OAuth
lead: Every organization has its own MCP server and its own OAuth 2.1 authorization server. An agent acts for a signed-in user, limited to both the scopes the user consented to and the user's own permissions.
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

The [OAuth endpoints](/docs/api/oauth/) page lists every route.

## Scopes and tools

| Scope | Grants | Tools |
|---|---|---|
| `mcp:read` (the default) | `view_members`, listing teams | `whoami`, `list_members`, `list_teams` |
| `mcp:invite` | `invite_members` | `invite_member` |
| `ontology:read` | `view_objects` | `describe_schema`, `query_objects`, `get_object`, `query_timeseries`, `latest_points` |
| `ontology:write` | `edit_objects` (writing needs `ontology:read` too) | `create_object`, `update_object`, `write_points` |
| `actions:apply` | no permission on its own: the user's [action](/docs/concepts/actions/) grants, with `ontology:read` for the types each action touches | `list_actions`, one `action_<api_name>` tool per action |

A tool's permission must be allowed by **both** the grant's scopes and the
user's own permissions, and both are checked again on every call, so a user
who loses a permission loses it in their agents too. No scope reaches
owner-only actions, the security posture, organization settings, or the
ontology's schema.

The ontology tools run the same functions as the REST API: the same
restricted-type access, value checks, custom validators, and live events.
The [timeseries](/docs/concepts/timeseries/) tools read and write series
under the same rules as their REST endpoints. A
refused call is a tool error (`isError: true`) whose text is the REST error:

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
- Tools never exceed the grant's scopes or the user's current permissions.
- Authorization codes and refresh tokens are single-use and bound to their
  client; replaying a used code or a rotated-out refresh token revokes the
  grant.
- Revocation sticks: none of a revoked grant's tokens work afterwards.
