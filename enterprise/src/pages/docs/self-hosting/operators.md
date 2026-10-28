---
layout: ../../../layouts/Docs.astro
title: Operators
lead: Whoever runs the server signs in to the management API with a password, a hardware security key such as a YubiKey, or both. Sessions are short, sensitive changes need a fresh password or touch, the last credential can never be removed, and every request is logged.
---

The [management API](/docs/api/management/) creates organizations and
registers their identity providers' signing keys. `MANAGEMENT_AUTH` is a
comma-separated list of the ways callers may authenticate:

| In `MANAGEMENT_AUTH` | Accepts |
|---|---|
| `jwt` (the default) | Ed25519 JWTs signed by a key in `MANAGEMENT_JWT_PUBLIC_KEYS`, for provisioning scripts |
| `webauthn` | operator sessions opened with a security key |
| `password` | operator sessions opened with a username and password |

The [Docker image](/docs/self-hosting/docker/) uses `password,webauthn`.
Without `jwt`, no JWT is accepted and `MANAGEMENT_JWT_PUBLIC_KEYS` is not
needed.

Credentials never cross: operator sessions (`hems_...`) are refused by the
organization API, and organization credentials by the management API.

## Operators

An **operator** is a person who runs the server, with a username and
password, one or more enrolled security keys, or both.

## First run

With `password` on, the server serves nothing until an enabled operator has
a password: both listeners answer `503 setup_required` to everything except
`/health`, `/v1/setup` and `/v1/auth/methods`. Two ways to create that
first operator, the admin:

* **The setup code.** At startup the server logs a one-time code,
  `XXXX-XXXX-XXXX`. `POST /v1/setup` with the code, a username and a
  password creates the admin and signs them in. The code changes on every
  restart until setup is done, and each replica logs its own.
* **`ADMIN_PASSWORD`**, with `ADMIN_USERNAME` (default `admin`), creates the
  admin at startup. It is read only while no operator has a password; remove
  it afterwards.

[Docker](/docs/self-hosting/docker/#first-run) walks through both.

## Passwords

Operator passwords are 12 to 256 characters and stored as argon2id hashes.
Usernames are 1 to 64 characters of `a-z`, `0-9`, `.`, `_` and `-`. An
operator gets a password at creation (`POST /v1/operators` with `username`
and `password`), or later with `PUT /v1/operators/{id}/password`, which
ends the operator's other password sessions. Failed sign-ins back off as
[organization passwords](/docs/concepts/authentication/#failed-attempts) do.

## Security keys

A key is registered through a **single-use enrollment link**
that is valid for 15 minutes:

```text
<first MANAGEMENT_WEBAUTHN_ORIGIN>/console/enroll#token=<token>
```

The first operator of a deployment without `password` is enrolled from the
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

Sign-in is a username and password, or a WebAuthn assertion with **user
verification** (the key's PIN or a fingerprint) and **user presence** (a
touch) from an enrolled key, of an enabled operator. Both open the same
kind of session, a `hems_` bearer token:

- it ends after `MANAGEMENT_SESSION_TTL` (15 minutes), or after
  `MANAGEMENT_SESSION_IDLE` (5 minutes) without a request;
- it also ends at sign-out, when its operator is disabled, when the key it
  was opened with is removed, or when the operator's password is changed
  or removed (for a session opened with the password).

Only a hash of the token is stored.

## Step-up

Some operations need a **fresh confirmation** within `MANAGEMENT_STEP_UP_WINDOW`
(5 minutes), from the sign-in or a step-up. Without one, they are
`403 step_up_required`:

- creating organizations, and making owner links for them;
- registering or revoking their signing keys;
- every change to operators, their keys and their passwords.

An operator with a usable security key steps up only with the key: a touch
of their own key. An operator with only a password steps up by entering
it again. JWT callers are not asked to step up. To require a touch for
everything, use `MANAGEMENT_AUTH=webauthn` alone.

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

## The last credential

The last active credential, a key or password of an enabled operator, is
never removed. Keys count with `webauthn` on, passwords with `password` on.
Deleting it, or disabling or deleting its operator, is `409`: add another
first. So a deployment always keeps a way in.

## Owner links

An organization's owner can be given a password from here. `POST
/v1/organizations/{id}/owner-link` (with step-up, and `ORG_PASSWORD_AUTH`
on) makes a single-use set-password link, valid for 24 hours, for an
address: the organization's bootstrap owner address by default. While the
organization has no owner, the link makes that address its first owner.
Otherwise it resets the password of the owner with that address, ending
their sessions. For any other address it does nothing. Every link is in the
audit log with its organization and address.

## The audit log

Every management request except `/health` is recorded: the method and
route, the status, the operator, key and session or the JWT's subject, the
client IP, and details such as the concrete path, why a request failed,
what it changed, and the key used for step-up. Enrollments made from the
command line are recorded too. Read it with `GET /v1/audit`.

Setup, sign-in, step-up and enrollment requests are rate limited to 30 per 10
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

## In the console

The [operator console](/docs/web-app/#the-operator-console) does all of
this in the browser:

- **Setup**, on a new server: the setup code from the log, the admin's
  username, and a password typed twice.
- **Sign-in** offers the methods the server enables: a username and
  password, a security key, or a management JWT, pasted or signed from a
  private key.
- **Enrollment links** open `/console/enroll`, which registers the key and
  explains a `key_not_allowed` refusal.
- **Step-up.** When an operation needs a fresh confirmation, the console
  asks for a touch of the key, or for the password from an operator without
  one, and retries.
- **Operators**: add one with a username and password, a key enrollment
  link, or both; set, change, or remove passwords; make new links;
  disable, enable, delete, and remove keys, with the last-credential
  refusal explained.
- **Owner links** on an organization's page, shown with a copy button.
- **The audit log**, with filters.
- The sidebar counts down to the session's end, and returns to sign-in when
  it ends.
