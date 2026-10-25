---
layout: ../../../layouts/Docs.astro
title: Files and email
lead: Avatars, organization photos, and attachments go to a local directory or an S3 bucket and are always served through the API, to whoever may see an object that refers to them. Login codes and invites go out through one of five email providers.
---

## Files

Three kinds of file exist:

- a user's **avatar** (`PUT /v1/me/avatar`) and the **organization photo**
  (`PUT /v1/org/photo`): PNG, JPEG, GIF, or WebP images up to 5 MB;
- **attachments** (`POST /v1/files?name=<file name>`), which any member may
  upload: any media type, up to 25 MiB, with an optional name of 1 to 255
  characters and no control characters, `/`, or `\`.

Each is uploaded as the raw request body with its `Content-Type`. Image
types must match their content: the server checks the bytes against the
declared type and refuses anything else, so an SVG or HTML file cannot pass
as an image.

```sh
curl -X POST "$BASE/v1/files?name=invoice-1042.pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/pdf" \
  --data-binary @invoice-1042.pdf
```

```json
201 { "id": "f6i2l8e4i0d9x3c7v1b5n2m6", "purpose": "attachment",
      "name": "invoice-1042.pdf", "content_type": "application/pdf",
      "size_bytes": 48213, "sha256": "9f2c...", "created_at": "2026-10-31T09:00:00Z" }
```

Files are stored in the configured blob store under
`<org_id>/<file_id>`, with their metadata in the organization's rows
of the `files` table. Their ids are what `file_ref` properties of
[ontology objects](/docs/concepts/ontology/#property-types) hold, at the top
level or nested in structs and lists.

### Who may read a file

Bytes are always proxied by the server, `GET /v1/files/{id}`, never served
from the store directly. A file can be read:

- by every member, if it is the organization photo;
- by its owner and holders of `view_members`, if it is an avatar;
- by its uploader, if it is an attachment;
- by anyone who may view a live object whose visible properties refer to it
  through a `file_ref`.

Anyone else gets `404`, as if the file did not exist.

So an attachment follows the objects that refer to it. A write may only add
a `file_ref` to a file its writer can read; any other counts as an unknown
id (`422`). Sharing an object shares its files, and unsharing the object,
deleting it, or removing the property ends that access at once. A document
whose versions are files in a list lets everyone who sees the document read
every version, and nobody else. See
[Example: document management](/docs/examples/documents/).

Responses carry `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, and
`Cache-Control: private, max-age=300`. Attachments are also sent as
downloads, with `Content-Disposition: attachment` and the file's name
(RFC 6266, with a UTF-8 `filename*`).

Not built yet: there is no upload quota, attachments that nothing refers to
are kept forever, and MCP clients cannot upload files (they can refer to
files their user can already read).

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
