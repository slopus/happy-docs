---
layout: ../../../layouts/Docs.astro
title: Two-factor authentication
lead: An organization can require a second factor of every human. Sessions without one are partial and reach only what they need to finish logging in.
---

## Factors

Two kinds of second factor exist, and a user may enroll several of each.

| Kind | What | Details |
|---|---|---|
| `totp` | authenticator apps | RFC 6238, HMAC-SHA1, 30-second steps, 6 digits, one step of clock skew either way. The 20-byte secret is sealed with ChaCha20-Poly1305 under a key derived from `SERVER_SECRET_KEY`. A code is never accepted twice: each use must be for a later time step than the last. |
| `webauthn` | security keys (YubiKey and the like) and passkeys | WebAuthn ceremonies through webauthn-rs, with relying party `WEBAUTHN_RP_ID` and origin `WEBAUTHN_ORIGIN`. Each ceremony is valid for 5 minutes. |

Enrolling a TOTP factor returns the secret and an `otpauth://` URI to show as
a QR code. It stays unconfirmed until the user sends a code from the app.
Enrolling a WebAuthn factor is two calls: `register/start` returns
`PublicKeyCredentialCreationOptions` for `navigator.credentials.create()`,
and `register/finish` takes the result.

## Requiring 2FA

A member with `change_security_posture` sets `require_2fa` on the
organization (`PUT /v1/org/security`). From then on, a human's credential is
**full** only if it is:

- a session that completed a second factor, or
- an external JWT whose `amr` claim contains `"mfa"`. The organization's
  identity provider can already mint tokens for any of its users, so its
  attestation is trusted as far as its signature is.

Anything else is **partial**. Agents have no second factor and are exempt by
kind: their API tokens and external JWTs are always full.

## Partial sessions

A partial session gets `403` everywhere except a short list of routes:

```json
{ "error": { "code": "mfa_required", "message": "complete a second factor (or enroll one) first" } }
```

| Allowed while partial | |
|---|---|
| `GET /v1/me` | shows what to do next in its `mfa` field |
| `POST /v1/auth/logout` | |
| `POST /v1/auth/2fa/totp`, `POST /v1/auth/2fa/webauthn/start`, `POST /v1/auth/2fa/webauthn/finish` | complete the second factor |
| `GET /v1/me/2fa`, `POST /v1/me/2fa/totp`, `POST /v1/me/2fa/totp/{factor}/confirm`, `POST /v1/me/2fa/webauthn/register/start`, `POST /v1/me/2fa/webauthn/register/finish` | list and enroll factors |

The `mfa` object returned by login and by `GET /v1/me` says where a session
stands:

```json
{
  "required": true,
  "satisfied": false,
  "factors": ["totp"],
  "enrollment_required": false
}
```

- `enrollment_required: true`: 2FA is required and the user has no factor
  yet. The partial session may enroll one, and confirming it completes the
  session.
- Otherwise the user already has a factor, and the session must **verify an
  existing one**. A partial session cannot enroll a new factor in that case,
  so someone who steals a session cannot add their own authenticator.

External JWTs of humans without `"mfa"` in `amr` are partial too, and since
they have no session to complete a factor on, they can do no more than the
list above.

## Keeping factors safe

- **Failures end the session.** Ten failed second-factor attempts revoke the
  session. Attempts are also rate limited per user across sessions (20 per
  15 minutes) and per IP (60 per 15 minutes).
- **The last factor stays.** While the organization requires 2FA, a user
  cannot delete their last confirmed factor. Deleting any factor needs a full
  session.
- **Rotating `SERVER_SECRET_KEY`** logs everyone out and makes every TOTP
  factor unusable, because both derive from it.

## In the OAuth sign-in pages

MCP clients sign in through the organization's OAuth pages, and the same rules
apply there: after the email code, a user with a factor verifies it, and a
user without one (when the organization requires one) enrolls a security key,
a passkey, or an authenticator app before the consent screen. See
[MCP and OAuth](/docs/concepts/mcp/).

In short: a partial session reaches only the partial routes, a partial
session of a user with a factor becomes full only by proving possession of
an existing factor, and the last factor is kept while 2FA is required.
