---
layout: ../../../layouts/Docs.astro
title: OAuth endpoints
lead: Each organization is its own OAuth 2.1 authorization server, issuer <PUBLIC_BASE_URL>/orgs/{org}, for MCP clients.
---

MCP clients discover and use these endpoints on their own; you rarely call
them by hand. See [MCP and OAuth](/docs/concepts/mcp/) for the flow and the
security properties. OAuth errors use the OAuth format:

```json
{ "error": "invalid_grant", "error_description": "..." }
```

## Discovery

### GET /.well-known/oauth-protected-resource/orgs/{org}/mcp

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>CORS</b>any origin</span></p>

RFC 9728 protected resource metadata, linked from the MCP endpoint's `401`.

```json
{
  "resource": "https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za/mcp",
  "authorization_servers": ["https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za"],
  "scopes_supported": ["mcp:read", "mcp:invite", "ontology:read", "ontology:write", "actions:apply",
                       "chat:read", "chat:write"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Happy Enterprise"
}
```

### GET /.well-known/oauth-authorization-server/orgs/{org}

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>CORS</b>any origin</span></p>

RFC 8414 authorization server metadata. Also served at
`/orgs/{org}/.well-known/oauth-authorization-server`.

```json
{
  "issuer": "https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za",
  "authorization_endpoint": "https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za/oauth/authorize",
  "token_endpoint": "https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za/oauth/token",
  "registration_endpoint": "https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za/oauth/register",
  "revocation_endpoint": "https://enterprise.example.com/orgs/c8kq2m7xw3n5p9r1t4v6y0za/oauth/revoke",
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["mcp:read", "mcp:invite", "ontology:read", "ontology:write", "actions:apply",
                       "chat:read", "chat:write"],
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "authorization_response_iss_parameter_supported": true
}
```

Both documents look the same for every well-formed organization id, existing
or not.

## Registration

### POST /orgs/{org}/oauth/register

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>CORS</b>any origin</span><span><b>Rate limit</b>20 / hour per IP, 100 / hour per organization</span></p>

RFC 7591 dynamic registration of a public client.

```json
{
  "client_name": "Claude",
  "redirect_uris": ["http://127.0.0.1/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

`201`:

```json
{
  "client_id": "l4c8l2i6e0n3t7x1q5w9r3y7",
  "client_id_issued_at": 1793000000,
  "client_name": "Claude",
  "redirect_uris": ["http://127.0.0.1/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

- 1 to 10 `redirect_uris`: `https`, loopback `http` (`localhost`, `127.0.0.1`,
  `[::1]`; any port matches at use), or a custom scheme.
- Only `token_endpoint_auth_method: none`, grant types `authorization_code`
  and `refresh_token`, response type `code`.
- `client_name` up to 200 characters, default "MCP client".
- At most 500 clients per organization.

## Authorization

### GET /orgs/{org}/oauth/authorize

<p class="ep-meta"><span><b>Auth</b>none (the user signs in on the pages)</span></p>

Standard authorization code request:

| Parameter | |
|---|---|
| `response_type` | `code` |
| `client_id`, `redirect_uri` | a registered client and one of its redirect URIs |
| `code_challenge`, `code_challenge_method` | PKCE, `S256` only, required |
| `scope` | space-separated; default `mcp:read` |
| `state` | optional, up to 1000 characters, returned unchanged |
| `resource` | optional (RFC 8707); if given, must be this organization's MCP endpoint |

An unknown client or redirect URI gets an error page. Other errors redirect
back to the client with `error`, `error_description`, `iss`, and `state`. A
valid request is recorded, bound to the browser by a cookie, and redirected to
its request page. On approval, the browser goes to
`redirect_uri?code=...&state=...&iss=...`.

### GET /orgs/{org}/oauth/requests/{request}

<p class="ep-meta"><span><b>Auth</b>the request's browser cookie</span></p>

The sign-in page for the current step: email, code, second factor
(verification or first enrollment), or consent. Server-rendered HTML with a
nonce-based CSP, `X-Frame-Options: DENY`, and `Cache-Control: no-store`.
Requests expire after 30 minutes.

### POST /orgs/{org}/oauth/requests/{request}

<p class="ep-meta"><span><b>Auth</b>the request's browser cookie</span></p>

The forms of those pages: send a code, check it, verify or enroll a TOTP
factor, approve or deny. Same-origin only; rate limited like the REST login
and second-factor endpoints.

### POST /orgs/{org}/oauth/requests/{request}/webauthn/start

<p class="ep-meta"><span><b>Auth</b>the request's browser cookie</span></p>

WebAuthn assertion options for the signed-in user's keys, used by the page's
script.

### POST /orgs/{org}/oauth/requests/{request}/webauthn/finish

<p class="ep-meta"><span><b>Auth</b>the request's browser cookie</span></p>

Completes the assertion: `{ "mfa_satisfied": true }`.

### POST /orgs/{org}/oauth/requests/{request}/webauthn/register/start

<p class="ep-meta"><span><b>Auth</b>the request's browser cookie</span></p>

For a user with no factor in an organization that requires one: registration
options for a first security key or passkey.

### POST /orgs/{org}/oauth/requests/{request}/webauthn/register/finish

<p class="ep-meta"><span><b>Auth</b>the request's browser cookie</span></p>

Completes the registration: `{ "factor_id": "...", "mfa_satisfied": true }`.

## Tokens

### POST /orgs/{org}/oauth/token

<p class="ep-meta"><span><b>Auth</b>none (public clients)</span><span><b>CORS</b>any origin</span><span><b>Rate limit</b>120 / min per IP, 60 / min per client</span></p>

Form-encoded (`application/x-www-form-urlencoded`).

Exchanging a code:

```sh
curl -X POST "$BASE/orgs/$ORG/oauth/token" \
  -d grant_type=authorization_code \
  -d code=... \
  -d code_verifier=... \
  -d client_id=l4c8l2i6e0n3t7x1q5w9r3y7 \
  -d redirect_uri=http://127.0.0.1:53682/callback
```

Refreshing:

```sh
curl -X POST "$BASE/orgs/$ORG/oauth/token" \
  -d grant_type=refresh_token \
  -d refresh_token=her_s7d2f9g4h1j6k3l8z5x0c2v7_... \
  -d client_id=l4c8l2i6e0n3t7x1q5w9r3y7
```

Both answer, with `Cache-Control: no-store`:

```json
{
  "access_token": "eyJhbGciOiJFZERTQSIsImtpZCI6ImhlLXNlc3Npb24tdjEifQ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "her_s7d2f9g4h1j6k3l8z5x0c2v7_...",
  "scope": "mcp:read ontology:read"
}
```

- A code lives 120 seconds and is consumed by any presentation. A wrong
  client, redirect URI, or verifier, or a reused code, is `invalid_grant`
  **and revokes the grant**.
- Every refresh returns a new refresh token. Presenting a rotated-out one is
  `invalid_grant` and revokes the grant.
- `unsupported_grant_type` for anything but the two grants above.

### POST /orgs/{org}/oauth/revoke

<p class="ep-meta"><span><b>Auth</b>none (public clients)</span><span><b>CORS</b>any origin</span><span><b>Rate limit</b>120 / min per IP, 60 / min per client</span></p>

RFC 7009. Form fields `token` (a refresh or access token) and `client_id`.

```sh
curl -X POST "$BASE/orgs/$ORG/oauth/revoke" -d token=her_... -d client_id=l4c8l2i6e0n3t7x1q5w9r3y7
```

Revoking either kind of token ends the whole grant, if the token belongs to
this client at this organization. Always `200` otherwise, changing nothing.
`400 invalid_request` if a field is missing.
