---
layout: ../../../layouts/Docs.astro
title: "Example: document management"
lead: Folders and documents shared with people and teams, every version a file. An intake agent files a scanned invoice, a colleague approves it, a manager's assistant finds what was shared with the manager, and unsharing ends that access to the document and its files at once.
---

This page walks through one complete scenario: the model, the six actions,
and every request in order, including the ones that are refused. Everything
here uses the public API, so you can load the same model into your own
organization and replay it.

![The invoice in the web app, with its owner, editors, team, and versions](/shots/example-documents.webp)

## Who takes part

| | Identity | Connects with | Team |
|---|---|---|---|
| **intake-bot** | an agent account that files scanned mail | REST, with its API token | `finance` |
| **Ann**, in finance | a person, in your app | REST, with a session token | `finance` |
| **Ben**, a manager | a person, through an assistant | MCP, with an OAuth grant of `ontology:read actions:apply` | none |
| **Cleo**, in records | a person, in your app | REST, with a session token | `records` |

Every member holds `view_objects` through `everyone`, as in any new
organization. **Nobody holds `edit_objects`.** Folders are set up by the
owner, and documents change only through the actions below, which every
member is granted. The actions decide who may add a version, share, or
finalize.

## The model

| Object type | Properties |
|---|---|
| `folder` | `name`, `owner`, `shared_with` (a list of users), `shared_teams` (a list of teams) |
| `document` | `title`, `owner`, `editors` and `viewers` (lists of users), `teams` (a list of teams), `status`: `draft`, `final`, or `archived`; `tags`, `current_version`, `current_file`, `versions` |

`versions` is a list of structs, one per version:

```json
{ "api_name": "versions", "type": { "kind": "array", "items": { "type": { "kind": "struct", "fields": [
  { "api_name": "number", "type": { "kind": "integer" }, "required": true },
  { "api_name": "file",   "type": { "kind": "file_ref" }, "required": true },
  { "api_name": "note",   "type": { "kind": "string" } },
  { "api_name": "author", "type": { "kind": "user_ref" }, "required": true },
  { "api_name": "at",     "type": { "kind": "timestamp" }, "required": true } ] } } } }
```

Each version's file is an [attachment](/docs/concepts/files-and-email/),
uploaded with `POST /v1/files`. Whoever can see the document can read every
one of its files, and nobody else can.

| Link type | From → to | Cardinality | Names |
|---|---|---|---|
| `folder_parent` | folder → folder | many to one | `parent` / `subfolders` |
| `document_folder` | document → folder | many to one | `folder` / `documents` |

The owner seeds four folders:

| Folder | Shared with |
|---|---|
| Company | the `everyone` team |
| Finance | the `finance` team |
| Invoices, inside Finance | the `finance` team |
| Sales | Ann and Ben |

### Who sees what

Both types are restricted, with the people and teams they name as their
[access properties](/docs/concepts/ontology/#shared-and-assigned-objects):

```json
PUT /v1/ontology/object-types/document/access
{ "restricted": true,
  "access_properties": ["owner", "editors", "viewers", "teams"],
  "grants": [
    { "team_id": "<everyone>", "permission": "view_objects", "scope": "assigned" },
    { "team_id": "<records>", "permission": "view_objects" } ] }
```

Folders are the same, with `owner`, `shared_with`, and `shared_teams`. So
every member sees the folders and documents that name them or a team they
are on, and records sees all of them. Ben sees Company and Sales; Ann sees
all four folders; the agent sees Company, Finance, and Invoices.

Postgres enforces it. A document that is not shared with Ben does not exist
for Ben by any route, and neither do its files.

## The actions

| Action | Who, per its criteria | Does |
|---|---|---|
| `create_document` | anyone, in a folder they see | files a document owned by the caller as a `draft`, with version 1 if a file is given, and links it to the folder |
| `add_version` | the owner and editors | appends the next version, makes it current, and puts a `final` document back to `draft`; not for `archived` ones |
| `share_document` | the owner; editors may add viewers | adds a person as viewer or editor, and emails them |
| `share_with_team` | the owner and editors | lets a whole team view the document |
| `unshare_document` | the owner | removes a person or a team |
| `finalize_document` | the owner, for a draft with a version | sets the document `final` and sends a webhook to the records archive |

All six are granted to `everyone`. Who may do what is in their criteria,
because it depends on the document: being its owner or one of its editors.

### share_document

A Python criterion decides who may share, and Python edits move the person
between the two lists:

```python
def check(ctx):
    doc = ctx['objects']['document']['properties']
    me = ctx['caller']['id']
    role = ctx['params']['role']
    if ctx['params']['user'] == doc['owner']:
        return 'the owner already has the document'
    if doc['owner'] == me:
        return True
    if me in (doc.get('editors') or []) and role == 'viewer':
        return True
    return 'only the owner shares a document, and editors may only add viewers'
```

```python
def edits(ctx):
    doc = ctx['objects']['document']['properties']
    user = ctx['params']['user']
    editors = [u for u in (doc.get('editors') or []) if u != user]
    viewers = [u for u in (doc.get('viewers') or []) if u != user]
    if ctx['params']['role'] == 'editor':
        editors = editors + [user]
    else:
        viewers = viewers + [user]
    return [{'op': 'update_object', 'object': {'param': 'document'},
             'properties': {'editors': editors, 'viewers': viewers}}]
```

```json
"effects": [
  { "kind": "email", "to": { "param": "user" },
    "subject": "{{object.document.title}} was shared with you",
    "text": "You are now a {{param.role}} of {{object.document.title}}." }
]
```

### add_version

A declarative criterion and a Python one:

```json
"criteria": [
  { "name": "not_archived", "message": "archived documents get no new versions",
    "condition": { "op": "ne", "left": { "object": "document", "property": "status" },
                   "right": { "value": "archived" } } },
  { "name": "editor",
    "code": "def check(ctx):\n    doc = ctx['objects']['document']['properties']\n    me = ctx['caller']['id']\n    if doc['owner'] == me or me in (doc.get('editors') or []):\n        return True\n    return 'only the owner and editors add versions'\n" }
]
```

```python
def edits(ctx):
    doc = ctx['objects']['document']['properties']
    number = doc['current_version'] + 1
    version = {'number': number, 'file': ctx['params']['file'],
               'author': ctx['caller']['id'], 'at': ctx['now']}
    if ctx['params'].get('note') is not None:
        version['note'] = ctx['params']['note']
    versions = (doc.get('versions') or []) + [version]
    changes = {'versions': versions, 'current_version': number,
               'current_file': ctx['params']['file']}
    if doc['status'] == 'final':
        changes['status'] = 'draft'
    return [{'op': 'update_object', 'object': {'param': 'document'}, 'properties': changes}]
```

The `file` parameter is a `file_ref`, so the caller must be able to read the
file: one they uploaded, or one already on an object they can see.

## Setting it up

As an owner, through the REST API:

1. Create the `finance` and `records` teams, with no permissions
   ([teams API](/docs/api/teams/)). Add Ann and the agent to `finance`, and
   Cleo to `records`.
2. Create the object types and link types
   ([schema API](/docs/api/ontology-schema/)), and restrict both types as
   above.
3. Create the six action types and grant each to `everyone`
   ([actions API](/docs/api/actions/)).
4. Create the four folders.

## 1. The agent files an invoice

intake-bot uploads the scan:

```http
POST /v1/files?name=invoice-1042.pdf
Authorization: Bearer heat_...
Content-Type: application/pdf

201 { "id": "<scan>", "purpose": "attachment", "name": "invoice-1042.pdf", ... }
```

Only the agent can read the file so far. It files the document in Invoices
with the scan as version 1:

```http
POST /v1/actions/create_document/apply
{ "params": { "title": "Invoice 1042 - Acme Paper", "folder": "<invoices>",
              "file": "<scan>", "note": "Scanned", "tags": ["invoice", "acme"] } }

201 { "created": [{ "type": "document", "ref": "document", ... }], ... }
```

The agent owns the document, so it sees it. Then it shares it with
`finance`, with an idempotency key:

```http
POST /v1/actions/share_with_team/apply
{ "params": { "document": "<invoice>", "team": "<finance>" },
  "idempotency_key": "share-1042" }

201 { "application_id": "<a2>", "replayed": false, ... }
```

The answer is lost, so it sends the same request again: `200` with
`replayed: true` and the same `application_id`. Nothing is applied twice.

## 2. Finance reads it; Ben does not

Ann is in `finance`, so Ann reads the invoice and downloads its scan:
`GET /v1/ontology/objects/document/<invoice>` and `GET /v1/files/<scan>`
are both `200`. For Ben, not in `finance`, both are `404`: to Ben neither
the document nor the file exists.

**Denied.** Ann tries to change the title directly:

```http
PATCH /v1/ontology/objects/document/<invoice>
{ "properties": { "title": "x" } }

403 { "error": { "code": "forbidden", ... } }
```

Nobody holds `edit_objects`; documents change only through actions.

**Refused by a criterion.** Ann uploads an approval stamp and tries to add
it as a version. Seeing the document through a team makes Ann a viewer, not
an editor:

```json
422 { "error": { "code": "criteria_failed",
      "details": [{ "path": "criteria.editor",
                    "message": "only the owner and editors add versions" }] } }
```

## 3. Two versions at once

The agent makes Ann an editor (`share_document`, role `editor`), and Ann is
emailed "Invoice 1042 - Acme Paper was shared with you". Ann reads the
document and notes its version, 3.

Meanwhile the agent uploads a better scan and adds it, stating the version
it read:

```http
POST /v1/actions/add_version/apply
{ "params": { "document": "<invoice>", "file": "<rescan>", "note": "Better scan" },
  "expected_versions": { "document": 3 } }

201 { "updated": [{ "type": "document", "version": 4, ... }], ... }
```

**Conflict.** Ann adds the approval against version 3, read before the
rescan. Nothing is applied:

```json
409 { "error": { "code": "version_conflict",
      "details": [{ "path": "params.document", "message": "..." }] } }
```

Ann reads the document again and retries with version 4: `201`. The
document now has three versions, by the agent, the agent, and Ann, and
`current_file` is Ann's approval. Every version's file can be read by everyone
who sees the document, including the scan the agent uploaded.

## 4. Ann shares a budget with Ben

Ann uploads `q3-budget.pdf`, files it in Sales with `create_document`, and
shares it with Ben as a viewer:

```http
POST /v1/actions/share_document/apply
{ "params": { "document": "<budget>", "user": "<ben>", "role": "viewer" } }

201 { ... }
```

Ben is emailed "Q3 budget was shared with you". Ben can now download the
budget's file, but still not the invoice's (`404`).

## 5. Ben's assistant

Ben connects an MCP client and grants it `ontology:read actions:apply`.
Asked for every document (`query_objects` on `document`, no filter), it gets
one: the budget. Asked for folders, it gets Company and Sales. A search for
`budget` in titles finds the same document:

```json
{ "tool": "query_objects",
  "arguments": { "type": "document",
                 "filter": { "op": "contains", "property": "title", "value": "budget" } } }
```

Asked for the invoice by id (`get_object`), it gets an error: the invoice
does not exist for Ben.

**Refused by a criterion.** Asked to make Ben an editor, it tries anyway:

```json
{ "tool": "action_share_document",
  "arguments": { "document": "<budget>", "user": "<ben>", "role": "editor" } }

→ error { "code": "criteria_failed",
          "details": [{ "path": "criteria.may_share",
                        "message": "only the owner shares a document, and editors may only add viewers" }] }
```

Adding a version is refused the same way, at `criteria.editor`.

**Denied.** It tries to create a document of its own with `create_object`:
`forbidden`. Ben holds no `edit_objects`, and the grant has no
`ontology:write`.

## 6. Records, and the end of sharing

Cleo, in `records`, sees both documents, whoever owns them, but may not
finalize one:

```json
422 { "error": { "code": "criteria_failed",
      "details": [{ "path": "criteria.owner",
                    "message": "only the owner finalizes a document" }] } }
```

Ann, the budget's owner, finalizes it: `201`, and after commit the records
archive's webhook is sent. Then Ann stops sharing it with Ben:

```http
POST /v1/actions/unshare_document/apply
{ "params": { "document": "<budget>", "user": "<ben>" } }

201 { ... }
```

At once, Ben's assistant finds no documents, and Ben's download of
the budget's file is `404`.

## What everyone saw

The audit log (`GET /v1/action-applications`) holds nine applications:

| Action | By | Via |
|---|---|---|
| `create_document` | intake-bot | `rest`, `api_token` |
| `share_with_team` | intake-bot | `rest`, `api_token` |
| `share_document` (Ann as editor) | intake-bot | `rest`, `api_token` |
| `add_version` (rescan) | intake-bot | `rest`, `api_token` |
| `add_version` (approval) | Ann | `rest`, `session` |
| `create_document` (budget) | Ann | `rest`, `session` |
| `share_document` (Ben as viewer) | Ann | `rest`, `session` |
| `finalize_document` | Ann | `rest`, `session` |
| `unshare_document` | Ann | `rest`, `session` |

The replayed share and every refused call appear nowhere: they changed
nothing. The background job sent the two "was shared with you" emails and
the archive's webhook.

## What this shows

- **Sharing is data.** Who sees a document is in its own properties, users
  and teams alike, and the database enforces it for every read, query,
  event, action, and MCP tool.
- **Files follow the objects that refer to them.** Sharing a document
  shares every version's file, and unsharing it ends that at once. There is
  no separate file permission to keep in step.
- **The rules live in the actions.** Who may add a version, share, or
  finalize depends on the document, and every client, the agent's, Ann's,
  and Ben's assistant, meets the same rules.
- **Teams change access in one place.** Adding someone to `finance` shows
  them every invoice shared with it; removing them hides those at once.
- **Concurrent edits do not overwrite each other.** The second version
  stated what it read, and was refused until it read again.

## What it does not do yet

- **Folders do not pass their sharing on.** Each document carries its own
  access properties. Sharing a folder does not share its documents, and an
  action cannot yet update objects it was not given.
- **No share links.** Everyone who reads a document is a member of the
  organization.
- **No full-text search.** `contains` matches titles and other properties,
  not what is inside the files.
- **MCP clients cannot upload files.** They can refer to files their user
  can already read.
- **No upload quota**, and attachments that no object refers to are kept.
