---
layout: ../../../layouts/Docs.astro
title: Files and email
lead: Avatars and organization photos go to a local directory or an S3 bucket and are always served through the API. Login codes and invites go out through one of five email providers.
---

## Files

Two kinds of file exist: a user's **avatar** (`PUT /v1/me/avatar`) and the
**organization photo** (`PUT /v1/org/photo`). Both are images: PNG, JPEG,
GIF, or WebP, up to 5 MB, uploaded as the raw request body with a matching
`Content-Type`. The server sniffs the content and refuses anything whose bytes
do not match the declared type, so an SVG or HTML file cannot pass as an
image.

```sh
curl -X PUT "$BASE/v1/me/avatar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @ada.png
```

Files are stored in the configured blob store under
`<org_id>/<file_id>`, with their metadata in the organization's rows
of the `files` table. Their ids can be used
as `file_ref` values in the ontology.

### Serving

Bytes are always proxied by the server, `GET /v1/files/{id}`, never served
from the store directly:

- the organization photo is visible to every member,
- an avatar is visible to its owner and to holders of `view_members`;
  anyone else gets `404`.

Responses carry `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, and
`Cache-Control: private, max-age=300`.

### Stores

| `STORAGE_BACKEND` | |
|---|---|
| `local` (default) | a directory (`STORAGE_LOCAL_DIR`, default `data/files`). Writes go through a temporary file; temporary files older than an hour are swept at startup. |
| `s3` | any S3-compatible bucket (AWS, MinIO, R2, Versity), with SigV4 signing, an optional key prefix, a custom path-style endpoint, and temporary credentials. |

### Consistency

The blob is written before its row. If the request's transaction does not
commit (including when the client goes away mid-request), the blob is deleted
again in the background, with retries. Blobs of deleted rows are removed
after commit, with retries. The one residual case: a crash between storing a
blob and committing its row, or a store that keeps failing deletes, leaves an
unreferenced blob. It is logged and never served, because nothing refers to
it.

## Email

The server sends two kinds of email: login codes and invites. Pick a provider
with `EMAIL_PROVIDER`:

| Provider | Sends through | Configuration |
|---|---|---|
| `log` (default) | nothing: logs each message, including login codes | development only |
| `resend` | the [Resend](https://resend.com) API | `RESEND_API_KEY`, optional `RESEND_API_URL` |
| `ses` | Amazon SES v2 `SendEmail`, signed with SigV4 | `SES_REGION`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, optional `SES_SESSION_TOKEN`, `SES_ENDPOINT` |
| `smtp` | any SMTP server (lettre) | `SMTP_URL`, e.g. `smtps://user:pass@smtp.example.com` or `smtp://host:587?tls=required` |
| `webhook` | an HTTP `POST` to your own endpoint | `EMAIL_WEBHOOK_URL`, optional `EMAIL_WEBHOOK_SECRET` |

Every provider except `log` needs `EMAIL_FROM`.

### The webhook provider

The webhook receives a JSON body:

```json
{
  "from": "Acme <no-reply@acme.example>",
  "to": "ada@acme.example",
  "subject": "Your Acme sign-in code: 481920",
  "text": "Your sign-in code for Acme is 481920 ...",
  "html": null
}
```

With `EMAIL_WEBHOOK_SECRET` set, each request is signed:

```http
x-happy-enterprise-timestamp: 1793000000
x-happy-enterprise-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>">
```

Verify the signature over the timestamp, a dot, and the raw body, and reject
old timestamps.

### Delivery failures

A failed login-code delivery does not change the response of
`POST /v1/orgs/{org}/auth/email/start`, because a different response would
reveal that the address may log in; it is only logged. A failed invite
delivery fails the request with `502 upstream`, since the inviter needs to
know.
