---
layout: ../../../layouts/Docs.astro
title: Authentication
lead: Three kinds of bearer credential reach the organization API. Each resolves to one organization and one active user, or to the same 401.
---

Every organization API request outside the login endpoints sends
`Authorization: Bearer <credential>`. The verifier resolves the credential to
an organization and a user inside a transaction scoped to the organization it
claims, and that transaction is the only database access the request gets.
In every case the organization is the one that **owns** the key, session, or
token row found under that organization's row level security scope, never
just a claim.

## Session tokens

Logging in (an email code or an invite) creates a **session** and returns a
session token: an EdDSA JWT with header `kid: "he-session-v1"`, signed with a
per-organization key the server derives from `SERVER_SECRET_KEY` with HKDF.

| Claim | |
|---|---|
| `oid` | organization ID |
| `sub` | user id |
| `sid` | session id |
| `aud` | `happy-enterprise:org` (the organization API) for REST sessions, `happy-enterprise:mcp` for OAuth grants |
| `iat`, `exp` | REST sessions last 30 days |

Every request checks the session row: not revoked, not expired, and its user
still active. Logging out, revoking a session, and deactivating a user take
effect on the next request. A token signed for one organization does not
verify in another, because each organization's key is different.

## External JWTs

An organization can bring its own identity provider. The operator registers
the provider's Ed25519 public key for that organization through the
[management API](/docs/api/management/), with a `kid` of the operator's
choosing (`he-` prefixes are reserved). The provider then mints tokens like:

```json
{
  "header": { "alg": "EdDSA", "kid": "acme-idp-2026" },
  "claims": {
    "oid": "c8kq2m7xw3n5p9r1t4v6y0za",
    "sub": "h3jd8s0q2l5x7c1v9b4n6m8k",
    "aud": "happy-enterprise:org",
    "exp": 1793000000,
    "amr": ["pwd", "mfa"]
  }
}
```

The rules:

- `alg` must be `EdDSA` and `kid` must be present.
- The key is looked up under the claimed `oid`'s scope, and the signed `oid`
  must equal the key's owner, so one organization's key cannot mint tokens
  for another.
- `sub` must be an active user of that organization.
- `aud` must be the single string `happy-enterprise:org`, the organization
  API's audience. An array is rejected, even one containing the right value.
- `exp` is required; `nbf` is honored; 30 seconds of clock skew are allowed.
- `amr` (RFC 8176) is optional. `"mfa"` in it attests a second factor (see
  [Two-factor authentication](/docs/concepts/two-factor/)).
- Revoked keys stop working immediately.

External JWTs work on the REST API only, not on the MCP endpoint.

## Agent API tokens

Agents authenticate with API tokens of the form

```text
heat_<org id>_<token id>_<secret>
```

Only the SHA-256 of the secret is stored. A token is shown once, when it is
created: with the agent (`POST /v1/agents`) or later by an owner
(`POST /v1/agents/{agent}/tokens`). Owners revoke tokens individually, and
deactivating the agent revokes all of them. API tokens work on the REST API
only.

## Logging in with an email code

```http
POST /v1/orgs/{org}/auth/email/start
{ "email": "ada@acme.example" }

202 { "challenge_id": "q9w8e7r6t5y4u3i2o1p0a9s8", "expires_at": "2026-10-24T10:10:00Z" }
```

The answer is always `202` with a challenge id, whether or not the
organization exists and whether or not the address may log in. A 6-digit code
is emailed only if it may. The code expires after 10 minutes and allows five
attempts. Verifying it returns a session token:

```http
POST /v1/orgs/{org}/auth/email/verify
{ "challenge_id": "q9w8e7r6t5y4u3i2o1p0a9s8", "code": "481920" }
```

An address may log in when, in this order:

1. it belongs to an **active user** of the organization (a deactivated
   user's address may not);
2. it is the organization's **bootstrap owner** address and the organization
   has no active owner: the user is created and added to `owners`;
3. its domain is **exactly** one of the organization's verified domains: the
   user is created as a member of `everyone`.

Anyone else needs an invite.

## Invites

A member with `invite_members` invites an address. The server emails a link
to `INVITE_URL?org=<org id>&token=<token>`, where the token is
`hei_<invite id>_<secret>`. An invite:

- is bound to one address and one organization,
- works once,
- expires after 7 days,
- replaces any pending invite for the same address.

Accepting it (`POST /v1/orgs/{org}/invites/accept`) proves control of the
invited address, because the token was only ever sent there. It creates the
user if needed (with an optional `display_name`) and logs in.

## Verified domains

An organization may let anyone at its own email domains join without an
invite. A member with `change_security_posture` adds a domain and gets back a
DNS record to publish:

```text
_happy-enterprise.acme.example.  TXT  "happy-enterprise-verification=5f0c1e7a9b2d4c6e8f1a3b5c7d9e0f12"
```

The token is random per organization and domain. The verify endpoint looks
the record up and marks the domain verified only if one of the TXT values is
exactly `happy-enterprise-verification=<that token>`. Unverified domains admit
nobody. Verification is not re-checked later: removing the record does not
unverify the domain, deleting the domain does. An organization can have up to
50 domains.

## Ending sessions

- `POST /v1/auth/logout` ends the caller's own session.
- `GET /v1/me/sessions` and `DELETE /v1/me/sessions/{session}` list and end
  the caller's REST sessions and OAuth grants.
- Owners end every session and OAuth grant of a member with
  `DELETE /v1/members/{user}/sessions`; the member stays active and can log
  in again.
- Deactivating a member ends everything and keeps them out.

## One response for every failure

Every authentication failure returns the same response:

```http
401 Unauthorized
WWW-Authenticate: Bearer

{ "error": { "code": "unauthorized", "message": "unauthorized" } }
```

The reason (unknown organization, unknown `kid`, bad signature, expired,
revoked, deactivated user, wrong audience) is logged on the server but never
returned, so responses do not reveal which organizations, users, keys,
sessions, or invites exist.
