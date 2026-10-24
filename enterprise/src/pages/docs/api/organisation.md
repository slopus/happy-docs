---
layout: ../../../layouts/Docs.astro
title: Organisation
lead: The organisation's profile and photo, its security posture, its verified domains, and file downloads.
---

## Profile

### GET /v1/org

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>none</span></p>

```json
{
  "id": "c8kq2m7xw3n5p9r1t4v6y0za",
  "name": "Acme",
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

`name` is 1-200 characters. Returns the organisation.

### PUT /v1/org/photo

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_organization</span></p>

Uploads the organisation photo as the raw request body (PNG, JPEG, GIF, or
WebP, at most 5 MB, matching `Content-Type`). Replaces any previous photo.
Returns the organisation.

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

Addresses at a verified domain may join the organisation by logging in with an
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

### GET /v1/files/{file}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>photo: none; avatars: their owner or view_members</span></p>

The file's bytes with its stored `Content-Type`, plus
`X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, and
`Cache-Control: private, max-age=300`. An avatar you may not see is `404`.

```sh
curl "$BASE/v1/files/f6i2l8e4i0d9x3c7v1b5n2m6" -H "Authorization: Bearer $TOKEN" -o photo.png
```
