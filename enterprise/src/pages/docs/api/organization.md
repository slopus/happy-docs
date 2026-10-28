---
layout: ../../../layouts/Docs.astro
title: Organization
lead: The organization's profile and photo, its security posture, its verified domains, and file downloads.
---

## Profile

### GET /v1/org

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>none</span></p>

```json
{
  "id": "c8kq2m7xw3n5p9r1t4v6y0za",
  "name": "Acme",
  "slug": "acme",
  "photo_file_id": "f6i2l8e4i0d9x3c7v1b5n2m6",
  "require_2fa": true,
  "created_at": "2026-10-01T09:00:00Z"
}
```

### PATCH /v1/org

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_organization</span></p>

```json
{ "name": "Acme Corporation" }
```

`name` is 1-200 characters. Returns the organization. The
[slug](/docs/concepts/organizations/#the-organizations-address) cannot be
changed.

### PUT /v1/org/photo

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_organization</span></p>

Uploads the organization photo as the raw request body (PNG, JPEG, GIF, or
WebP, at most 5 MB, matching `Content-Type`). Replaces any previous photo.
Returns the organization.

```sh
curl -X PUT "$BASE/v1/org/photo" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/png" --data-binary @logo.png
```

### DELETE /v1/org/photo

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_organization</span></p>

`204`.

## Security posture

### GET /v1/org/security

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>change_security_posture</span></p>

```json
{ "require_2fa": true, "allowed_domains": ["acme.example"] }
```

`allowed_domains` lists the **verified** domains only.

### PUT /v1/org/security

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>change_security_posture</span></p>

```json
{ "require_2fa": true }
```

Returns the posture as above. Domains are managed through
[`/v1/org/domains`](#allowed-domains), not here; unknown fields are refused.
Turning `require_2fa` on makes every human session without a completed second
factor partial at its next request.

## Allowed domains

Addresses at a verified domain may join the organization by logging in with an
email code. See [Verified domains](/docs/concepts/authentication/#verified-domains).

A domain in responses:

```json
{
  "domain": "acme.example",
  "verified": false,
  "verified_at": null,
  "checked_at": null,
  "created_at": "2026-10-24T10:00:00Z",
  "txt_record": {
    "name": "_happy-enterprise.acme.example",
    "value": "happy-enterprise-verification=5f0c1e7a9b2d4c6e8f1a3b5c7d9e0f12"
  }
}
```

### GET /v1/org/domains

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>change_security_posture</span></p>

Every domain, verified or not, in alphabetical order.

### POST /v1/org/domains

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>change_security_posture</span></p>

```json
{ "domain": "acme.example" }
```

Adds an unverified domain (lowercased, trailing dot removed) and returns it
with the TXT record to publish, `201`. `409` if already added, `400` for an
invalid name or past 50 domains.

### POST /v1/org/domains/{domain}/verify

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>change_security_posture</span></p>

Looks up the TXT records at `_happy-enterprise.<domain>` and marks the domain
verified if one of them is exactly the expected value. Returns the domain.

- Not found, and the domain was never verified: `400` naming the record to
  publish.
- Not found, but the domain was verified before: it stays verified (`200`,
  `checked_at` updated).
- DNS lookup failure: `502`.

### DELETE /v1/org/domains/{domain}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>change_security_posture</span></p>

`204`. Users who joined through the domain stay members.

## Files

### POST /v1/files

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>any member</span></p>

Uploads an attachment. The body is the file's bytes and `Content-Type` its
media type (`application/octet-stream` if none is given). Query parameter
`name` (optional): 1 to 255 characters, no control characters, `/`, or `\`.

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

`sha256` is hex. Until an object refers to it, only the uploader can read
the file. `400` for an empty body, a bad name, or a `Content-Type` that is not
a media type or (for PNG, JPEG, GIF, and WebP) does not match the bytes;
`413` over 25 MiB.

### GET /v1/files/{file}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>see below</span></p>

The file's bytes with its stored `Content-Type`, plus
`X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, and
`Cache-Control: private, max-age=300`. Attachments also carry
`Content-Disposition: attachment` with their name.

Readable by everyone for the organization photo; by its owner and holders of
`view_members` for an avatar; by its uploader for an attachment; and, for
any file, by anyone who may view a live object whose visible properties refer
to it through a `file_ref`. Anyone else gets `404`. See
[Who may read a file](/docs/concepts/files-and-email/#who-may-read-a-file).

```sh
curl "$BASE/v1/files/f6i2l8e4i0d9x3c7v1b5n2m6" -H "Authorization: Bearer $TOKEN" -o invoice-1042.pdf
```
