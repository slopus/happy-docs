---
layout: ../../../layouts/Docs.astro
title: Login and sessions
lead: Server-wide sign-in and sign-up, email-code and password login, set-password links, invite acceptance, completing a second factor, and logging out.
---

`{org}` in these URLs is the organization's
[slug](/docs/concepts/organizations/#the-organizations-address) or its id.
See [Authentication](/docs/concepts/authentication/) for the rules behind
these endpoints, and [Two-factor authentication](/docs/concepts/two-factor/)
for partial sessions.

## The login response

Email verification, password sign-in, the identity exchange, and invite acceptance all answer with a new session:

```json
{
  "token": "eyJhbGciOiJFZERTQSIsImtpZCI6ImhlLXNlc3Npb24tdjEifQ.eyJ0aWQiOi...",
  "token_type": "Bearer",
  "expires_at": "2026-11-23T10:00:00Z",
  "org_id": "c8kq2m7xw3n5p9r1t4v6y0za",
  "user_id": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "session_id": "s0e8r4t2y6u1i9o3p7a5d2f4",
  "mfa": {
    "required": false,
    "satisfied": true,
    "factors": [],
    "enrollment_required": false
  }
}
```

Send `token` as `Authorization: Bearer <token>`. If `mfa.satisfied` is
`false`, the session is partial: verify a factor (or enroll one, if
`enrollment_required`) before using the rest of the API.

## Email codes

### POST /v1/orgs/{org}/auth/email/start

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Rate limit</b>30 / 10 min per IP, 5 / 15 min per organization and address</span></p>

Starts a login. Always answers `202` with a challenge, whether or not the
organization exists or the address may log in; the 6-digit code is emailed
only if it may.

```sh
curl -X POST "$BASE/v1/orgs/$ORG/auth/email/start" \
  -H "Content-Type: application/json" \
  -d '{"email": "ada@acme.example"}'
```

```json
{ "challenge_id": "q9w8e7r6t5y4u3i2o1p0a9s8", "expires_at": "2026-10-24T10:10:00Z" }
```

`400` if the address is not a valid email address.

### POST /v1/orgs/{org}/auth/email/verify

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Rate limit</b>60 / 10 min per IP</span></p>

```json
{ "challenge_id": "q9w8e7r6t5y4u3i2o1p0a9s8", "code": "481920" }
```

`200` with the [login response](#the-login-response). A wrong code, an
expired or used challenge, five failed attempts, or an address that may not
log in are all the same `401`.

### GET /v1/orgs/{org}/auth/methods

<p class="ep-meta"><span><b>Auth</b>none</span></p>

The organization's slug and name, and how its people can sign in. This is
what an organization's sign-in page shows. `404` if no organization has
that slug or id.

```json
{ "org": { "slug": "acme", "name": "Acme" }, "email_code": true, "password": true }
```

## Server-wide sign-in

One emailed code for the whole server, then an organization to enter. See
[Signing in to the server](/docs/concepts/authentication/#signing-in-to-the-server).

### POST /v1/auth/start

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Rate limit</b>30 / 10 min per IP, 5 / 15 min per address</span></p>

```json
{ "email": "ada@acme.example", "turnstile_token": "..." }
```

Always `202` with `{challenge_id, expires_at}`. The code is emailed only if
the address has an organization to enter or may sign up. `turnstile_token`
is required when the server has Turnstile keys (the site key is in
[`GET /v1/signup`](#get-v1-signup)); `403 turnstile_failed` if Cloudflare
does not accept it. `400` for an invalid address.

### POST /v1/auth/verify

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Rate limit</b>60 / 10 min per IP</span></p>

```json
{ "challenge_id": "q9w8e7r6t5y4u3i2o1p0a9s8", "code": "481920" }
```

```json
{
  "identity_token": "heid_...",
  "email": "ada@acme.example",
  "expires_at": "2026-10-28T10:15:00Z",
  "orgs": [
    { "id": "c8kq2m7xw3n5p9r1t4v6y0za", "slug": "acme", "name": "Acme", "how": "member" },
    { "id": "d2kf8s0q2l5x7c1v9b4n6m8z", "slug": "acme-labs", "name": "Acme Labs", "how": "invite" }
  ],
  "signup_enabled": false
}
```

`how` is `member`, `owner_claim`, `domain`, or `invite`. The identity token
lasts 15 minutes and can be exchanged at any listed organization, as often
as needed while it lasts. A wrong, expired, or used-up code is `401`.

### POST /v1/orgs/{org}/auth/identity

<p class="ep-meta"><span><b>Auth</b>identity token</span><span><b>Rate limit</b>60 / 10 min per IP</span></p>

```json
{ "identity_token": "heid_..." }
```

`200` with the [login response](#the-login-response): the session an
email-code login to `{org}` would open, joining the same way, or the
address's pending invite accepted. `401` for a bad or expired token, `403
inactive` if the address may not enter, `404` for an unknown organization.

## Sign-up

See [Sign-up](/docs/concepts/authentication/#sign-up).

### GET /v1/signup

<p class="ep-meta"><span><b>Auth</b>none</span></p>

Always `200`, whether sign-up is on or not:

```json
{ "enabled": true, "email_domains": ["acme.example"], "turnstile_site_key": "0x4AAAAAAA..." }
```

`email_domains` is empty when any domain may sign up, and
`turnstile_site_key` is `null` without Turnstile.

### GET /v1/signup/slug/{slug}

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Rate limit</b>60 / min per IP</span></p>

Whether a slug is free for a new organization:

```json
{ "slug": "acme", "available": false, "reason": "taken" }
```

`reason` is `taken`, `reserved`, or `invalid`, and absent when the slug is
available. `404` while sign-up is off.

### POST /v1/signup/finish

<p class="ep-meta"><span><b>Auth</b>identity token</span><span><b>Rate limit</b>60 / 10 min per IP</span></p>

```json
{ "identity_token": "heid_...", "org_name": "Acme", "slug": "acme", "display_name": "Ada Lovelace" }
```

Creates the organization with the token's address as its first owner, and
signs them in. `201` with the [login response](#the-login-response) plus
`"org": {"id", "slug", "name"}`.

| Status | When |
|---|---|
| `401` | a bad or expired identity token |
| `400` | `org_name` is not 1-200 characters |
| `422 email_domain_not_allowed` | the address is not at one of `ORG_SIGNUP_EMAIL_DOMAINS` |
| `429 signup_limit` | the address created `ORG_SIGNUP_DAILY_LIMIT` organizations today |
| `409 slug_taken`, `422 slug_reserved`, `422 slug_invalid` | the slug cannot be had |
| `404` | sign-up is off |

## Passwords

These routes exist only with `ORG_PASSWORD_AUTH=true`; otherwise they are
`404`. See [Signing in with a password](/docs/concepts/authentication/#signing-in-with-a-password).

### POST /v1/orgs/{org}/auth/password

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Rate limit</b>60 / 10 min per IP, and the password backoff</span></p>

```json
{ "email": "ada@acme.example", "password": "a long owner password" }
```

`200` with the [login response](#the-login-response), for an active person
of the organization who has a password. Every failure, whether an unknown
organization, an unknown address, no password set, or a wrong password, is
the same `401`. `429` with `Retry-After` while this client is locked out
for this account. `400` if the address is not a valid email address.

### POST /v1/orgs/{org}/auth/password/reset

<p class="ep-meta"><span><b>Auth</b>link token</span><span><b>Rate limit</b>60 / 10 min per IP</span></p>

Redeems a set-password link: the token from the link's fragment
(`#token=...`) and the new password, 12 to 256 characters.

```json
{ "token": "...", "password": "a long new password" }
```

```json
{ "user_id": "h3jd8s0q2l5x7c1v9b4n6m8k", "email": "ada@acme.example", "sessions_ended": 2 }
```

All of the user's sessions end; sign in again with the new password. An
owner link for an organization without an owner creates its first owner.
An unknown, used, or expired link, a member link for a deactivated member,
or an owner link for an address that is no longer an owner's, is `401`. `400` for a password that is too short or too long.

## Invites

### POST /v1/orgs/{org}/invites/accept

<p class="ep-meta"><span><b>Auth</b>none</span><span><b>Rate limit</b>60 / 10 min per IP</span></p>

Accepts an invite with the token from the invite email
(`hei_<invite id>_<secret>`) and logs in as the invited user, creating them if
needed. `display_name` (optional, 1-200 characters) names a new user;
otherwise the name is derived from the address.

```json
{ "token": "hei_i5n1v7i3t9e2x6c0q4w8r2t6_Zq3...", "display_name": "Grace Hopper", "password": "a long new password" }
```

`password` (optional, 12 to 256 characters) sets the user's password; it
needs `ORG_PASSWORD_AUTH`, and is `400` without it.

`200` with the [login response](#the-login-response). An unknown, revoked,
used, or expired invite is `401`. `409` if the address belongs to a
deactivated member.

## Second factor

These complete the second factor of the current session. They need a session
(not an external JWT or API token). Ten failures revoke the session.

### POST /v1/auth/2fa/totp

<p class="ep-meta"><span><b>Auth</b>partial</span><span><b>Rate limit</b>60 / 15 min per IP, 20 / 15 min per user</span></p>

```json
{ "code": "123456" }
```

```json
{ "mfa_satisfied": true }
```

A wrong or replayed code is `401`.

### POST /v1/auth/2fa/webauthn/start

<p class="ep-meta"><span><b>Auth</b>partial</span></p>

Starts a WebAuthn assertion against the user's registered security keys and
passkeys. Pass `options` to `navigator.credentials.get()`.

```json
{
  "ceremony_id": "w3e9b1a5u7t2h6n0f4a8c2t6",
  "options": { "publicKey": { "challenge": "...", "allowCredentials": [ ... ], "rpId": "enterprise.example.com" } }
}
```

### POST /v1/auth/2fa/webauthn/finish

<p class="ep-meta"><span><b>Auth</b>partial</span><span><b>Rate limit</b>60 / 15 min per IP, 20 / 15 min per user</span></p>

```json
{ "ceremony_id": "w3e9b1a5u7t2h6n0f4a8c2t6", "credential": { "id": "...", "rawId": "...", "response": { ... }, "type": "public-key" } }
```

```json
{ "mfa_satisfied": true }
```

## Logging out

### POST /v1/auth/logout

<p class="ep-meta"><span><b>Auth</b>partial</span></p>

Ends the current session. `204`. `400` for credentials without a session
(external JWTs, API tokens). To end other sessions, see
[Your account](/docs/api/me/#sessions).
