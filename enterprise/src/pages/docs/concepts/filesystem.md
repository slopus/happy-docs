---
layout: ../../../layouts/Docs.astro
title: Filesystems
lead: A filesystem type is one tree of folders and files, for people and agents alike. Every write of a file is a version, any folder can be restricted to some teams, and a folder hidden from someone hides everything under it. The database itself decides who sees each folder and file.
---

A filesystem type is an object type of kind `filesystem`. It is part of the
[ontology](/docs/concepts/ontology/), with versions, access settings,
grants, and live events, but it holds one **tree** of **folders** and
**files** rather than objects. The tree's root folder is created with the
type. The object, link and action APIs refuse it; folders and files have
[their own endpoints](/docs/api/filesystem/).

```json
POST /v1/ontology/object-types
{
  "api_name": "drive",
  "display_name": "Drive",
  "kind": "filesystem",
  "properties": [
    { "api_name": "status", "type": { "kind": "string" },
      "rules": [{ "rule": "enum", "values": ["draft", "final"] }] }
  ],
  "filesystem": { "trash_days": 14 }
}
```

Here every folder and file can be marked `draft` or `final`, and deleted
items stay in the trash for two weeks.

## Folders and files

- **Names** are 1-255 characters, without control characters, `/` or `\`,
  and not `.` or `..`. Spaces, dots and any script are fine:
  `Q3 report (final).pdf`.
- **Paths** such as `/Projects/Q3/plan.md` are made of the names, and are
  resolved through the folders you see. The root is `/`. Folders nest at
  most 64 deep.
- **Names are unique within a folder**, among the items you can see there.
  A restricted folder hidden from you never takes a name from you, so a
  taken name never shows that a hidden folder exists. Two items in one
  folder can therefore share a name, for people who see both; a path to
  them is then `409`, and you use their ids.
- **Fields.** The type's properties are optional **fields** of every
  folder and file: up to 32 of them, of kind `integer`, `double`,
  `boolean`, or `string`, with the built-in
  [format rules](/docs/concepts/ontology/#format-rules) but not `unique`,
  `sequence`, custom validators, or custom formats. A filesystem type may
  have none. Fields are checked on every write, and problems are reported
  at `fields.<name>`.
- **Versions.** Every folder and file has a `version` that each change
  raises. Writes may name an `expected_version`, and are `409` if the item
  has moved on, so two writers never overwrite each other unknowingly.
- **Listing** shows folders first, then files, by name.
- **Name search** finds folders and files by part of their name,
  case-insensitively, with their paths. It is a substring match on names
  only; [search](/docs/concepts/search/) finds names and the text of text
  files by words, ranked, across every type.

## File contents

Every write of a file's content is a new **content version**, numbered 1,
2, 3, .... Each version is stored in the organization's
[blob store](/docs/concepts/files-and-email/) with its content type, size,
and SHA-256, and every version stays readable until the file is purged.

- **Uploads** are the request body, up to 25 MiB. You write by name, in a
  folder (a new file, or a new version of the file of that name), or by
  the file's id.
- **Identical uploads change nothing.** Writing the same bytes with the
  same content type as the current version adds no version and sends no
  event; the answer says `unchanged: true`. So a retried upload is safe.
- **Content types.** The `Content-Type` you declare is kept, but a declared
  image must really be one. Without one, the type is guessed from the
  name: `.md` is `text/markdown`, `.csv` is `text/csv`, and unknown
  extensions are `application/octet-stream`.
- **Downloads** are always sent as attachments, never sniffed or run in a
  browser, with the content version in `X-Content-Version`.

## Restricted folders

Any folder, the root included, can be **restricted** to teams, each
granted one level:

| Level | Allows |
|---|---|
| `read` | listing, reading details, downloading |
| `write` | also creating folders, uploading, renaming, moving, deleting, restoring |
| `manage` | also restricting folders and granting access to them |

- **A hidden folder hides everything under it.** An item is visible only
  if every restricted folder from the root down to it admits you, through
  a grant to one of your teams. A grant on a folder deep inside does not
  reach through a restricted folder above it that hides it from you.
- **The nearest restricted folder sets your level.** Where you see an
  item, your level there is the highest one the nearest restricted folder
  above it (or the item itself) grants your teams. Where no folder on the
  path is restricted, it is `write`.
- **The type's access comes first.** Without `edit_objects` on the
  filesystem type, your level is at most `read` everywhere.
- **Owners** see every folder and manage everything, except what is in the
  trash under a restricted folder.
- **Assistants never manage.** OAuth credentials are held to `write`, an
  owner's included, so access to folders is changed only by a person in
  the web app, or with a session or an API token.
- **Managers keep access.** A restriction must grant `manage` to one of
  the manager's own teams (`422` otherwise); owners need not.
- **Changes take effect at once.** Restricting a folder hides it, and
  everything in it, from everyone else; lifting the restriction shows it
  to everyone who sees the folder it is in. Moving a folder out of a
  restricted one shows it to whoever sees where it went, and a restricted
  folder that moves keeps its own grants.

Every item in responses carries your `level` there.

## Who sees what

Postgres decides first. Row level security shows a folder or file to a user
only if every restricted folder above it admits them. A file's versions and
an item's events are seen only with the item. Whatever the request, a
hidden folder and everything under it do not exist for that user, and no
write can put an item where its writer would no longer see it.

Then the API checks permissions:

- **Reading** needs `view_objects` on the filesystem type.
- **Writing** needs `edit_objects` on the type too, and the level the
  write asks for. Moving needs `write` on the item, on the folder it
  leaves, and on the folder it goes to, and a folder never moves inside
  itself.
- **An item you cannot see is `404`**, as if it did not exist.

Filesystem types take restricted access and grants like any type, but no
`access_properties` and no property restrictions.

## The trash

Deleting a folder or file moves it to the trash, with everything under it.
A deleter needs `write` on the item, on its folder, and on every folder
under it they see; deleting a folder that holds folders they may only read
is `409`. What they cannot see goes too, and stays hidden from everyone,
owners included, until a restore.

- **Restoring** brings an item back where it was, with everything that
  went with it. Its folder must not be in the trash itself (restore that
  first), and if its name has been taken meanwhile, you restore it under a
  new one.
- **`trash_days`** (1-3,650, default 30) is how long deleted items can be
  restored. The trash lists each with its `purge_after` time.
- **Purging.** After `trash_days`, the maintenance job removes the items,
  deepest first, with every version and its stored blob. The trash cannot
  be emptied by hand.
- **Deleting the type.** A filesystem type can be deleted only once its
  tree is empty, the trash aside, and only by someone who sees all of it
  (`409` otherwise). The maintenance job then removes the tree, trash
  included.

## Live events

Every change is an [event](/docs/concepts/live-events/) on the
organization's stream, with the filesystem `type` and the `node`:

| Event | Data |
|---|---|
| `fs.node.created` | the new folder or file, with its path |
| `fs.file.written` | `name`, `parent`, `version`, `content_version`, `size_bytes`, `content_type`, `sha256` |
| `fs.node.changed` | `kind`, `name`, `parent`, `version`, and `renamed_from` after a rename |
| `fs.node.moved` | `kind`, `name`, `parent`, `version`, `from`, `to` |
| `fs.node.deleted`, `fs.node.restored` | `kind`, `name`, `parent` |
| `fs.node.access` | `kind`, `name`, `restricted` |

An event reaches a subscriber only while they can see its folder or file.
A new file sends `fs.node.created` and `fs.file.written`; a new version
sends `fs.file.written`.

## Through MCP

Assistants use filesystems with their own scopes: `files:read` for
`list_files`, `read_file`, and `search_files`, and `files:write` (with
`files:read`) for `write_file`, `make_folder`, `move_file`, and
`delete_file`. The tools take paths or ids, and read files up to 1 MiB, as
text or base64. The files scopes reach only filesystems, and neither the
ontology nor the chat scopes reach them. See
[MCP tools and scopes](/docs/api/mcp/#list_files).

Folder creation, uploads, renames, moves, deletions, and restores are
[rate limited](/docs/concepts/rate-limits/) to 300 a minute per user,
through REST and MCP together.

## Not there yet

- **Name search reads the whole tree**: at a million items, about 0.6
  seconds for a member and 3.6 for an owner, who sees more. Full-text
  [search](/docs/concepts/search/) indexes names and the current version
  of text files up to 1 MiB, but not other files or earlier versions. Listing a folder and reading an item by id or path stay at a
  few milliseconds however large the tree grows.
- **Uploads are single requests** of up to 25 MiB, with no multipart or
  resumable uploads.
- **No quota, and every version is kept** until its file is purged.
- **Assistants restore nothing.** Restoring from the trash, and changing
  who may use a folder, are done in the web app or the REST API.
