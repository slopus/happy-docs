---
layout: ../../../layouts/Docs.astro
title: Search
lead: One search across an organization's objects, chat messages, and files, ranked, with highlighted snippets. It finds only what the person searching could open directly, and the database itself makes sure hidden text never matches, ranks, or shows.
---

`GET /v1/search?q=` looks through everything the caller may read, in one
request, and the MCP `search` tool does the same for assistants. The
index follows every write as it commits: an edit is found by its new
words, and a deletion is gone from the results at once.

```http
GET /v1/search?q=hydraulic%20leak

200 { "results": [
        { "kind": "message", "type": "incident_chat", "id": "m3s5g7e9a1b2c4d6e8f0g1h2",
          "score": 4, "field": "body",
          "snippet": { "text": "Hydraulic leak at Press 7, line stopped",
                       "highlights": [[0, 9], [10, 14]] },
          "channel_id": "c7h2a9n4n1e8l3x6q5w0e2r4", "thread_root_id": null }, ... ],
      "kinds": ["object", "message", "file"], "next_cursor": "4.m3s5g7e9a1b2c4d6e8f0g1h2" }
```

## What is searched

| Kind | Text |
|---|---|
| `object` | the top-level `string` properties of objects, and every string in their lists of strings, for object and team types |
| `message` | the text of [chat](/docs/concepts/chat/) messages |
| `file` | the names of [filesystem](/docs/concepts/filesystem/) folders and files, and the text of text files (`text/*`, JSON, XML, YAML, TOML, JavaScript) up to 1 MiB, from their current version |

Up to the first 100,000 characters of each property, message, or file are
indexed. Timeseries points are not searched.

## Matching

- **Every word must match.** `quarterly dana` finds what contains both
  words, in the same field or in different ones; `quarterly zebra` finds
  nothing if no source has both.
- **Words of 3 or more characters also match as prefixes.** `payrol` finds
  `payroll`, and `eli` finds `Eli`. Shorter words match whole words only,
  so `el` does not find `Eli`.
- **No stemming.** Words are lower-cased and split at spaces and
  punctuation, but not reduced to a root: `invoices` does
  not find `invoice`, though `invoice` finds `invoices` as a prefix.
- A query is 1-200 characters, with at most 8 words.

## Ranking and snippets

Each matching word counts the weight of the field it is in, once for each
time it appears there, up to 5 times:

| Field | Weight |
|---|---|
| a file or folder's name | 4 |
| an object's property, a message | 2 |
| a file's text | 1 |

So a file named `handbook.md` comes before a file that only mentions a
handbook. Results come by score, highest first, then by id, and
`next_cursor` continues where a page ended.

Each result carries a **snippet** from its best matching field: up to two
short passages as plain `text`, and `highlights`, the character ranges of
the matched words in it. It also says which `field` the snippet is from,
and what you need to open the result: a message's channel and thread, or
a file's name, kind, and folder.

## Narrowing a search

- **`kind`**: `object`, `message`, `file`, or several, comma-separated.
  Without it, the search covers every kind the caller may read.
- **`type`**: one or more type `api_name`s, of any kind, such as
  `incident,incident_chat`.

## Only what you could open

A search returns only what the person searching could open directly with
a read, and finds it only through text that read would show them. The
database enforces this for every row of the index, whatever the query:

- **Restricted types**, and objects shared with or assigned to someone
  else, are not found.
- **Restricted properties** hidden from the caller never match, never add
  to a score, and never appear in a snippet. A document whose only match
  is in a property you cannot see is not found at all.
- **Chat:** messages of private channels and direct messages you are not
  in, channels about objects hidden from you, deleted channels, deleted
  messages, and messages past their chat type's retention are left out.
- **Filesystems:** folders and files under a restricted folder that hides
  them from you, and everything in the trash, are left out.

Then the API checks permissions, as for reads: `view_objects` on each type
searched, and for messages in channels about objects, on the object type
too. A kind you ask for without its permission is `403`, and a type you
cannot search is `404`, as if it did not exist.

## Through MCP

The `search` tool searches the same way. Each kind needs its own read
scope: `ontology:read` for objects, `chat:read` for messages, and
`files:read` for files. Without `kinds`, it searches every kind the grant
reaches; asking for a kind the grant lacks is refused. See
[MCP tools and scopes](/docs/api/mcp/#search).

## Not there yet

- **No stemming** or language settings: `invoices` does not find
  `invoice`.
- **Not indexed:** text inside struct properties, chat message fields, and
  the contents of attachments.
- **Only a file's current version** is searched; earlier versions are not.
- **Very common words are slower.** Ranking needs every match, so a word
  found in half of a million items takes a couple of seconds. With several
  words, the rarest one does most of the work, so adding a rarer word
  makes a search faster.
- **The filesystem name search** (`GET /v1/fs/trees/{type}/search`) is
  still a substring match on names, separate from this search.
