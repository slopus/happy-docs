---
layout: ../../../layouts/Docs.astro
title: Your account
lead: The caller's own profile, avatar, sessions and OAuth grants, and second factors.
---

## The user object

Members, `GET /v1/me`, and several other endpoints return users in this shape:

```json
{
  "id": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "kind": "human",
  "email": "ada@acme.example",
  "display_name": "Ada Lovelace",
  "about": "Analytical engines.",
  "birthday": "1815-12-10",
  "status": { "emoji": "🧮", "text": "Computing", "expires_at": "2026-10-24T18:00:00Z" },
  "avatar_file_id": "f6i2l8e4i0d9x3c7v1b5n2m6",
  "is_owner": true,
  "active": true,
  "created_at": "2026-10-01T09:00:00Z"
}
```

`kind` is `human` or `agent` (agents have no `email`). `status` is `null` when
unset or expired.

## Profile

### GET /v1/me

<p class="ep-meta"><span><b>Auth</b>partial</span></p>

Who you are, your organization, what you may do, and where your session
stands on two-factor authentication. Partial sessions may call it to find out
what to do next; their `permissions` and `teams` lists are empty.

```json
{
  "user": { "id": "h3jd8s0q2l5x7c1v9b4n6m8k", "kind": "human", "display_name": "Ada Lovelace", "...": "..." },
  "org": { "id": "c8kq2m7xw3n5p9r1t4v6y0za", "name": "Acme", "photo_file_id": null, "require_2fa": true },
  "permissions": ["invite_members", "view_members", "change_security_posture", "manage_organization",
                  "manage_ontology", "view_objects", "edit_objects"],
  "teams": [
    { "id": "o1w2n3e4r5s6t7e8a9m0a1b2", "name": "owners", "kind": "owners", "direct": true },
    { "id": "e1v2e3r4y5o6n7e8t9e0a1b2", "name": "everyone", "kind": "everyone", "direct": true },
    { "id": "m2n4b6v8c0x1z3l5k7j9h0g2", "name": "Engineering", "kind": "custom", "direct": false },
    { "id": "p7l3a9t2f4o8r1m5q6w0e2r4", "name": "Platform", "kind": "custom", "direct": true }
  ],
  "mfa": { "required": true, "satisfied": true, "factors": ["totp", "webauthn"], "enrollment_required": false }
}
```

`permissions` are the effective ones for this credential: team permissions
(all of them for owners) intersected with OAuth scopes, if any.

`teams` are your effective teams: those you are a current member of
(`direct: true`), and every team above them along inherited
[subteam links](/docs/concepts/organizations/#subteams) (`direct: false`).
These are the teams your grants come through.

### PATCH /v1/me

<p class="ep-meta"><span><b>Auth</b>full</span></p>

Changes your profile. Every field is optional; send only what changes.

```json
{
  "display_name": "Ada King",
  "about": "Countess of Lovelace.",
  "birthday": "1815-12-10",
  "status": { "emoji": "🏖️", "text": "On leave", "expires_at": "2026-11-01T00:00:00Z" }
}
```

| Field | Rules |
|---|---|
| `display_name` | 1-200 characters after trimming |
| `about` | up to 2000 characters |
| `birthday` | `YYYY-MM-DD` between 1900-01-01 and today; `null` clears it |
| `status` | `emoji` up to 32 characters, `text` up to 200, optional `expires_at`; `null` clears the status |

Returns the updated user.

### PUT /v1/me/avatar

<p class="ep-meta"><span><b>Auth</b>full</span></p>

Uploads a new avatar as the raw request body: PNG, JPEG, GIF, or WebP, at most
5 MB, with a matching `Content-Type`. The previous avatar is deleted.

```sh
curl -X PUT "$BASE/v1/me/avatar" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" --data-binary @ada.jpg
```

Returns the updated user, whose `avatar_file_id` you can fetch with
[`GET /v1/files/{id}`](/docs/api/organization/#get-v1-files-file). `400` if the
content does not match the type, `413` if it is too large.

### DELETE /v1/me/avatar

<p class="ep-meta"><span><b>Auth</b>full</span></p>

`204`.

## Sessions

Your REST logins and the OAuth grants you gave MCP clients.

### GET /v1/me/sessions

<p class="ep-meta"><span><b>Auth</b>full</span></p>

Live (not revoked, not expired) sessions, newest first. `current` marks the
one making the request.

```json
{
  "sessions": [
    {
      "id": "s0e8r4t2y6u1i9o3p7a5d2f4",
      "kind": "api",
      "oauth_client_id": null,
      "oauth_client_name": null,
      "scopes": [],
      "created_at": "2026-10-24T10:00:00Z",
      "expires_at": "2026-11-23T10:00:00Z",
      "current": true
    },
    {
      "id": "s7d2f9g4h1j6k3l8z5x0c2v7",
      "kind": "oauth",
      "oauth_client_id": "l4c8l2i6e0n3t7x1q5w9r3y7",
      "oauth_client_name": "Claude",
      "scopes": ["mcp:read", "ontology:read"],
      "created_at": "2026-10-20T08:12:00Z",
      "expires_at": "2026-11-19T08:12:00Z",
      "current": false
    }
  ]
}
```

### DELETE /v1/me/sessions/{session}

<p class="ep-meta"><span><b>Auth</b>full</span></p>

Ends one of your sessions or OAuth grants. Its tokens, including an OAuth
grant's refresh token, stop working at once. `204`; `404` if it is not yours
or already ended.

## Second factors

See [Two-factor authentication](/docs/concepts/two-factor/). Enrollment works
from a partial session only while you have no confirmed factor.

### GET /v1/me/2fa

<p class="ep-meta"><span><b>Auth</b>partial</span></p>

```json
{
  "factors": [
    { "id": "w3e9b1a5u7t2h6n0f4a8c2t6", "kind": "totp", "name": "Authenticator app", "confirmed": true,
      "created_at": "2026-10-02T09:00:00Z", "last_used_at": "2026-10-24T10:01:00Z" }
  ],
  "status": { "required": true, "satisfied": true, "factors": ["totp"], "enrollment_required": false }
}
```

### POST /v1/me/2fa/totp

<p class="ep-meta"><span><b>Auth</b>partial</span></p>

Starts enrolling an authenticator app. The optional `name` is up to 100
characters (default "Authenticator app"). Any earlier unconfirmed TOTP factor
is discarded.

```json
{ "name": "Phone" }
```

`201`:

```json
{
  "factor_id": "w3e9b1a5u7t2h6n0f4a8c2t6",
  "secret": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "otpauth_uri": "otpauth://totp/Acme:ada@acme.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Acme&algorithm=SHA1&digits=6&period=30"
}
```

Show `otpauth_uri` as a QR code, or `secret` for manual entry.

### POST /v1/me/2fa/totp/{factor}/confirm

<p class="ep-meta"><span><b>Auth</b>partial</span><span><b>Rate limit</b>60 / 15 min per IP, 20 / 15 min per user</span></p>

```json
{ "code": "123456" }
```

```json
{ "factor_id": "w3e9b1a5u7t2h6n0f4a8c2t6", "confirmed": true }
```

Confirming a factor from a partial session also completes that session's
second factor. `400` for a wrong code.

### POST /v1/me/2fa/webauthn/register/start

<p class="ep-meta"><span><b>Auth</b>partial</span></p>

Starts registering a security key or passkey. Optional body
`{ "name": "YubiKey 5C" }`. Pass `options` to `navigator.credentials.create()`.

```json
{
  "ceremony_id": "w3e9b1a5u7t2h6n0f4a8c2t6",
  "options": { "publicKey": { "rp": { "id": "enterprise.example.com", "name": "Happy Enterprise" }, "challenge": "...", "...": "..." } }
}
```

The ceremony is valid for 5 minutes.

### POST /v1/me/2fa/webauthn/register/finish

<p class="ep-meta"><span><b>Auth</b>partial</span></p>

```json
{ "ceremony_id": "w3e9b1a5u7t2h6n0f4a8c2t6", "credential": { "id": "...", "rawId": "...", "response": { ... }, "type": "public-key" } }
```

`201`:

```json
{ "factor_id": "x8d1c4v7b0n3m6a9s2d5f8g1", "confirmed": true }
```

### DELETE /v1/me/2fa/{factor}

<p class="ep-meta"><span><b>Auth</b>full</span></p>

Removes a factor. `204`. `409` if the organization requires 2FA and this is
your last confirmed factor.
