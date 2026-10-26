---
layout: ../../../layouts/Docs.astro
title: Filesystems
lead: Trees, folders, files, content versions, search, the trash, and restricted folders, for the filesystem types of an organization.
---

[Filesystems](/docs/concepts/filesystem/) explains folders, files, levels,
who sees what, and the trash. Filesystem types are created with the
[ontology schema](/docs/api/ontology-schema/#filesystem-types) endpoints.

Every endpoint here needs `view_objects` on the filesystem type, and writes
need `edit_objects` on it too (`403` without). A folder or file you cannot
see is `404`, and so is a type you cannot read; a type of another kind is
`400`. Each endpoint also needs a level on the item, set by the nearest
restricted folder: `read`, `write`, or `manage` (`403` below it). Creating
folders, uploads, renames, moves, deletions, and restores are
[rate limited](/docs/concepts/rate-limits/) to 300 a minute per user.

## Folders and files

A folder or file (a **node**) in responses:

```json
{
  "id": "n2f8k4d6q1w9e3r7t5y0u2i4",
  "type": "drive",
  "kind": "file",
  "name": "invoice-1042.pdf",
  "parent": "n7c3x9z1v5b8n2m4q6w0e2r4",
  "path": "/Finance/Invoices/invoice-1042.pdf",
  "restricted": false,
  "fields": { "status": "draft" },
  "version": 2,
  "level": "write",
  "content_version": 2,
  "size_bytes": 48213,
  "content_type": "application/pdf",
  "sha256": "9f2c...e41a",
  "created_by": "a9g3e7n1t5b2o8t4q6w0e2r4",
  "created_at": "2026-10-26T09:00:00Z",
  "updated_by": "a9g3e7n1t5b2o8t4q6w0e2r4",
  "updated_at": "2026-10-26T09:20:00Z"
}
```

`version` rises with every change to the node, and is what
`expected_version` compares. `level` is what you may do there. Files also
show their current `content_version`, `size_bytes`, `content_type`, and
`sha256`; folders have none of these. Nodes in the trash also show
`deleted_at` and `deleted_by`. Listings leave out `path`.

### GET /v1/fs/trees/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The tree's root folder: `name` is empty, `path` is `/`, and `parent` is
`null`.

### GET /v1/fs/trees/{type}/resolve

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

`?path=/Finance/Invoices/invoice-1042.pdf`: the node at that path, through
the folders you see. A leading or trailing `/` is optional. `422` for an
invalid path, `404` if a name on it is missing, and `409` ("several items
are named ...; use their ids") if two items you see share a name on it.

### GET /v1/fs/trees/{type}/search

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

Folders and files out of the trash whose name contains `q`, ignoring case,
sorted by name: `{"nodes": [...]}`, each with its `path`. `%` and `_` in
`q` match themselves.

| Query | |
|---|---|
| `q` | 1-255 characters (`422` otherwise) |
| `limit` | 1-100, default 50 |

### GET /v1/fs/nodes/{node}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The node, with its path. Nodes in the trash are `404` here.

### GET /v1/fs/nodes/{folder}/children

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The folder's contents you see, folders first, then files, by name:
`{"folder": "...", "children": [...], "next_cursor": ...}`. `400` for a
file.

| Query | |
|---|---|
| `limit` | 1-1,000, default 200 |
| `cursor` | `next_cursor` of the previous page |

### POST /v1/fs/nodes/{folder}/children

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit_objects; write on the folder</span></p>

```json
{ "name": "Invoices", "fields": { "status": "draft" } }
```

`201` with the new folder. `name` is 1-255 characters, without control
characters, `/` or `\`, and not `.` or `..` (`422` otherwise); `fields`
are optional and checked against the type's properties (`422` at
`fields.<name>`). `409` if an item you see in the folder has the name.
`400` if the folder is a file, or the new folder would be more than 64
deep.

### PATCH /v1/fs/nodes/{node}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit_objects; write on the node, and to rename or move it, on its folder and the target folder</span></p>

```json
{ "name": "invoice-1042-acme.pdf", "parent": "n5t1q8w2e6r0t4y9u3i7o1p5",
  "fields": { "status": "final" }, "expected_version": 2 }
```

| Field | |
|---|---|
| `name` | a new name |
| `parent` | the folder to move the node to, in the same tree |
| `fields` | merged into the node's fields; `null` removes one |
| `expected_version` | `409` unless the node is at this version |

All are optional. Returns the node. `409` if an item you see in the
destination has the name. `400` for renaming or moving the root, moving to
another tree or into the node itself, or past 64 levels.

### DELETE /v1/fs/nodes/{node}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit_objects; write on the node, its folder, and every folder under it you see</span></p>

Moves the node to the trash, with everything under it. `204`.
`?expected_version=` is `409` unless the node is at that version. `409` if
it holds a folder you may only read; `400` for the root.

## File contents

### PUT /v1/fs/nodes/{folder}/files/{name}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit_objects; write on the folder, or on the file for a new version</span></p>

```http
PUT /v1/fs/nodes/n7c3x9z1v5b8n2m4q6w0e2r4/files/invoice-1042.pdf
Content-Type: application/pdf

<the file's bytes>
```

Writes the file named `name` (URL-encoded) in the folder: `201` with the
new file, or `200` with a new version of the file you see by that name.
Writing the same bytes and content type as the current version adds
nothing and returns `200` with `"unchanged": true`.

- The body is the content, up to 25 MiB (`413` over it).
- `Content-Type` is kept as the file's type; a declared image must match
  its bytes, and a value that is not a media type is `400`. Without one,
  the type is guessed from the name's extension.
- `?expected_version=0` writes only if no file has the name yet (`409`
  otherwise); any other number writes only if the file is at that
  `version` (`409` "the file is at version ...").
- `409` if a folder has the name, or two files you see do. `422` for an
  invalid name.

### GET /v1/fs/nodes/{file}/content

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The bytes of the current version, or of `?version=` (`404` if there is no
such version). Also for files in the trash. `400` for a folder.

The response carries the version's `Content-Type`,
`Content-Disposition: attachment` with the file's name,
`X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`,
`Cache-Control: private, no-cache`, the SHA-256 as its `ETag`, and the
content version in `X-Content-Version`.

### PUT /v1/fs/nodes/{file}/content

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit_objects; write on the file</span></p>

A new version of the file, by id, as `PUT .../files/{name}` writes it, with
`?expected_version=`. `200` with the file, `unchanged` for the same bytes
and type. `400` for a folder.

### GET /v1/fs/nodes/{file}/versions

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

Every content version, newest first. Also for files in the trash.

```json
{ "node": "n2f8k4d6q1w9e3r7t5y0u2i4",
  "versions": [
    { "version": 2, "content_type": "application/pdf", "size_bytes": 48213, "sha256": "9f2c...e41a",
      "created_by": "a9g3e7n1t5b2o8t4q6w0e2r4", "created_at": "2026-10-26T09:20:00Z" },
    { "version": 1, "content_type": "application/pdf", "size_bytes": 51870, "sha256": "4b7d...0c93",
      "created_by": "a9g3e7n1t5b2o8t4q6w0e2r4", "created_at": "2026-10-26T09:00:00Z" } ] }
```

## The trash

### GET /v1/fs/trees/{type}/trash

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

What was deleted in the tree and you can see, newest first, up to 1,000:
`{"nodes": [...]}`. Each node shows `deleted_at`, `deleted_by`, the
`parent_path` it was deleted from, and `purge_after`, when the maintenance
job removes it for good. Only what was deleted itself is listed, not the
items that went with a folder.

### POST /v1/fs/nodes/{node}/restore

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit_objects; write on the node and its folder</span></p>

```json
{ "name": "Q3 (old)" }
```

Brings a deleted node back where it was, with everything that went to the
trash with it, and returns it. The body is optional; `name` restores it
under a new name. `409` if an item you see in its folder has the name, or
if its folder is in the trash (restore that first). `400` for a node that
went to the trash with its folder.

## Folder access

### GET /v1/fs/nodes/{folder}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage on the folder</span></p>

```json
{ "node": "n9f4i1n6a2n7c3e8q5w0e2r4", "restricted": true, "inherited_from": null,
  "grants": [ { "team_id": "t1f2i3n4a5n6c7e8q9w0e1r2", "level": "write" },
              { "team_id": "t3r5e7c9o1r2d4s6q8w0e2r4", "level": "read" } ] }
```

For a folder that is not restricted, `grants` is empty and
`inherited_from` names the nearest restricted folder above it, which
decides levels there (`null` if there is none).

### PUT /v1/fs/nodes/{folder}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage on the folder</span></p>

```json
{ "restricted": true,
  "grants": [ { "team_id": "<finance>", "level": "write" },
              { "team_id": "<records>", "level": "read" } ] }
```

Restricts the folder to the teams it grants, replaces its grants, or, with
`restricted: false` and no grants, lifts the restriction. Changes apply at
once to the folder and everything under it. Returns the access, as `GET`
does.

| Field | |
|---|---|
| `restricted` | required |
| `grants` | up to 100 `{team_id, level}`, each team once; `level` is `read`, `write`, or `manage` |

`400` for grants on an unrestricted folder. `422` for an unknown team, a
team granted twice, or, unless you are an owner, grants that give none of
your teams `manage`. `409` if lifting the restriction would give the folder
the name of another item in its folder.
