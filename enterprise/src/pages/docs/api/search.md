---
layout: ../../../layouts/Docs.astro
title: Search
lead: Full-text search across the objects, chat messages, and files you may read, ranked, with snippets and highlight ranges.
---

[Search](/docs/concepts/search/) explains what is indexed, how words
match, how results are ranked, and what is left out.

### GET /v1/search

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects on the types searched</span></p>

```http
GET /v1/search?q=quarterly%20dana&kind=object,file&limit=20
```

| Query | |
|---|---|
| `q` | the words to find, 1-200 characters, at most 8 words (required) |
| `kind` | `object`, `message`, `file`, comma-separated; default: every kind you may read |
| `type` | type `api_name`s, comma-separated: only results of these types |
| `limit` | 1-50, default 20 |
| `cursor` | `next_cursor` of the previous page, with the same `q`, `kind`, and `type` |

```json
{
  "results": [
    {
      "kind": "object",
      "type": "employee",
      "id": "o4b8j2e6c0t1q5w9r3y7u2i6",
      "score": 6,
      "field": "notes",
      "snippet": { "text": "Dana leads the quarterly payroll review", "highlights": [[0, 4], [15, 24]] }
    },
    {
      "kind": "file",
      "type": "drive",
      "id": "n2f8k4d6q1w9e3r7t5y0u2i4",
      "score": 2,
      "field": "content",
      "snippet": { "text": "Quarterly plan, owner: Dana", "highlights": [[0, 9], [23, 27]] },
      "node_kind": "file",
      "name": "q3-plan.md",
      "parent_id": "n7c3x9z1v5b8n2m4q6w0e2r4"
    }
  ],
  "kinds": ["object", "file"],
  "next_cursor": "2.n2f8k4d6q1w9e3r7t5y0u2i4"
}
```

Results come by `score`, highest first, then by `id`. `next_cursor` is
`null` when there are no more.

| Field | |
|---|---|
| `kind` | `object`, `message`, or `file` (folders too) |
| `type` | the type's `api_name` |
| `id` | the object, message, or folder or file |
| `score` | the sum of the matched words' field weights |
| `field` | where the snippet is from: a property's `api_name` for objects, `body` for messages, `name` or `content` for files |
| `snippet` | `text`, up to two passages, and `highlights`, `[start, end)` ranges of matched words in characters |
| `channel_id`, `thread_root_id` | messages: the channel, and the first message of the thread for a reply (`null` otherwise) |
| `node_kind`, `name`, `parent_id` | files: `folder` or `file`, its name, and its folder |
| `kinds` (top level) | the kinds this search covered |

Open a result with its own read endpoint:
[`GET /v1/ontology/objects/{type}/{id}`](/docs/api/ontology-objects/),
[the channel's messages](/docs/api/chat/#get-v1-chat-channels-channel-messages),
or [`GET /v1/fs/nodes/{node}`](/docs/api/filesystem/#get-v1-fs-nodes-node).

**Errors.** `422` for an empty or longer `q`, more than 8 words, a
`limit` out of range, an unknown `kind`, or a `cursor` that is not one.
`403` for a `kind` you may not read (no `view_objects`, or a credential
without its scope), or if you may read none. `404` for a `type` you
cannot search, as if it did not exist. A `q` of punctuation only finds
nothing.
