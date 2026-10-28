---
layout: ../../../layouts/Docs.astro
title: Operators and security keys
lead: Whoever runs the server signs in to the management API with a hardware security key, such as a YubiKey, with a touch and a PIN. Sessions are short, sensitive changes need a fresh touch, the last key can never be removed, and every request is logged.
---

The [management API](/docs/api/management/) creates organizations and
registers their identity providers' signing keys. It accepts two kinds of
callers, chosen with `MANAGEMENT_AUTH`:

| `MANAGEMENT_AUTH` | Accepts |
|---|---|
| `jwt` (the default) | Ed25519 JWTs signed by a key in `MANAGEMENT_JWT_PUBLIC_KEYS`, for provisioning scripts |
| `webauthn` | only operator sessions, opened with a security key; `MANAGEMENT_JWT_PUBLIC_KEYS` is not needed |
| `jwt,webauthn` | both |

Credentials never cross: operator sessions (`hems_...`) are refused by the
organization API, and organization credentials by the management API.

## Operators

An **operator** is a person who runs the server, with one or more enrolled
security keys. A key is registered through a **single-use enrollment link**
that is valid for 15 minutes:

```text
<first MANAGEMENT_WEBAUTHN_ORIGIN>/console/enroll#token=<token>
```

The first operator of a `webauthn`-only deployment is enrolled from the
command line, on a machine with the server's environment:

```sh
happy-enterprise operator enroll --name "Sam Rivera"
# Operator o1p2e3r4...: open this link within 15 minutes to register a security key (single use):
# https://ops.example.com/console/enroll#token=...
```

`--operator <id>` instead makes a link for another key of an existing
operator. Once signed in, operators create links for new operators and
keys through the API (`POST /v1/operators`,
`POST /v1/operators/{id}/enrollments`). Enroll at least two keys per
operator, and keep one somewhere safe.

## Signing in

Sign-in is a WebAuthn assertion with **user verification** (the key's PIN
or a fingerprint) and **user presence** (a touch), from an enrolled key of
an enabled operator. It opens a session, a `hems_` bearer token:

- it ends after `MANAGEMENT_SESSION_TTL` (15 minutes), or after
  `MANAGEMENT_SESSION_IDLE` (5 minutes) without a request;
- it also ends at sign-out, when its operator is disabled, or when the key
  it was opened with is removed.

Only a hash of the token is stored.

## Step-up

Some operations need a **fresh touch**: an assertion of the operator's own
key within `MANAGEMENT_STEP_UP_WINDOW` (5 minutes), either the sign-in or
a step-up ceremony. Without one, they are `403 step_up_required`:

- creating organizations;
- registering or revoking their signing keys;
- every change to operators and their keys.

JWT callers are not asked to step up. To require a touch for everything,
use `MANAGEMENT_AUTH=webauthn` alone.

## Requiring YubiKeys

By default, any authenticator that does user verification can be enrolled:
security keys, the authenticators built into laptops and phones, and synced passkeys alike. To
accept only particular hardware keys, set both:

- `MANAGEMENT_WEBAUTHN_ATTESTATION_CA`: the path of a PEM bundle of
  attestation root certificates. For YubiKeys, Yubico's FIDO attestation
  root, from
  [developers.yubico.com/PKI/yubico-ca-certs.txt](https://developers.yubico.com/PKI/yubico-ca-certs.txt),
  which includes the root for firmware 5.7 and later.
- `MANAGEMENT_WEBAUTHN_AAGUIDS`: the AAGUIDs allowed, comma-separated. An
  AAGUID identifies an authenticator model and firmware. Yubico lists them
  on its "YubiKey Hardware FIDO2 AAGUIDs" page, they are in the FIDO
  Metadata Service, and `ykman fido info` shows a key's own. An enrolled
  key's verified AAGUID is also in `GET /v1/operators`.

With these set, enrollment asks for the key's attestation and accepts only
keys whose attestation chains to one of the roots, whose AAGUID is listed,
and which cannot be synced: **synced passkeys are refused**
(`403 key_not_allowed`). Only keys enrolled under the policy sign in, so
**turning it on retires keys enrolled earlier**: enroll replacements
right after enabling it, from the command line if needed.

## The last key

The last active key, a key of an enabled operator, is never removed.
Deleting it, or disabling or deleting its operator, is `409`: enroll
another key first. So a `webauthn`-only deployment always keeps a way in.

## The audit log

Every management request except `/health` is recorded: the method and
route, the status, the operator, key and session or the JWT's subject, the
client IP, and details such as the concrete path, why a request failed,
what it changed, and the key used for step-up. Enrollments made from the
command line are recorded too. Read it with `GET /v1/audit`.

Sign-in, step-up and enrollment requests are rate limited to 30 per 10
minutes per client IP and 600 per 10 minutes overall. The management
listener reads `CLIENT_IP_HEADER` like the organization one.

## Setting it up

One relying party serves a deployment: `MANAGEMENT_WEBAUTHN_RP_ID` must be
the host of every origin in `MANAGEMENT_WEBAUTHN_ORIGIN`, or a parent
domain of it. Keys registered under one id do not work under another.

```sh
MANAGEMENT_AUTH=webauthn
MANAGEMENT_WEBAUTHN_RP_ID=ops.example.com
MANAGEMENT_WEBAUTHN_ORIGIN=https://ops.example.com
MANAGEMENT_WEBAUTHN_ATTESTATION_CA=/etc/happy-enterprise/yubico-fido-root.pem
MANAGEMENT_WEBAUTHN_AAGUIDS=<the AAGUIDs of your YubiKey models>
```

For local development: `MANAGEMENT_WEBAUTHN_RP_ID=localhost` and
`MANAGEMENT_WEBAUTHN_ORIGIN=http://localhost:5173,http://localhost:8080`.
See [Configuration](/docs/self-hosting/configuration/#management) for every
variable.

**Hardware-held JWT keys.** Provisioning scripts that use JWTs can keep
their key on a YubiKey too: the server needs only the raw Ed25519 public
key, so the private key can stay in the key's OpenPGP applet (firmware
5.2.3 and later) or PIV (5.7 and later), signing
`base64url(header).base64url(claims)`. This setup has not been tested by
the project.

## Not there yet

- **The operator console does not sign in with security keys yet.** It
  still signs management JWTs in the browser. Until it does, the sign-in,
  step-up and enrollment ceremonies are run through the
  [API](/docs/api/management/#operators) with a WebAuthn client.
