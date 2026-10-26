---
layout: ../../../layouts/Docs.astro
title: Chat
lead: Channels, members, messages, threads, reactions, pins, read state, typing, and mentions, for the chat types of an organization.
---

[Chat](/docs/concepts/chat/) explains channel kinds, who sees what, and
what happens to messages. Chat types are created with the
[ontology schema](/docs/api/ontology-schema/#chat-types) endpoints.

Every endpoint here needs `view_objects` on the channel's chat type, and on
its object's type for a channel about an object. Writes need `edit_objects`
on the chat type too, and membership of the channel. A channel or message
you cannot read is `404`. Writing to a channel you are not a member of is
`409` ("join the channel first" on public channels), and so is writing to an
archived one. Posts, edits, reactions, and pins are
[rate limited](/docs/concepts/rate-limits/) per user.

## Channels

A channel in responses:

```json
{
  "id": "c7h2a9n4n1e8l3x6q5w0e2r4",
  "type": "incident_chat",
  "kind": "public",
  "name": "press-7-leak",
  "topic": "Hydraulic leak, Press 7",
  "object": "o4b8j2e6c0t1q5w9r3y7u2i6",
  "member_count": 3,
  "member": true,
  "created_by": "a9g3e7n1t5b2o8t4q6w0e2r4",
  "created_at": "2026-10-26T09:00:00Z",
  "updated_at": "2026-10-26T09:00:00Z",
  "archived": false,
  "archived_at": null,
  "last_seq": 2,
  "version": 1,
  "read_seq": 2,
  "unread": 0
}
```

`member` says whether you are a member, and `read_seq` and `unread` are
your read state. Direct messages also list their `members`.

### GET /v1/chat/channels

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The channels you may read, by id: `{"channels": [...], "next_cursor": ...}`.

| Query | |
|---|---|
| `type` | only this chat type's channels |
| `object` | only the channels about this object |
| `member` | `true`: only the channels you are a member of |
| `limit` | 1-200, default 100 |
| `cursor` | `next_cursor` of the previous page |

### POST /v1/chat/channels

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects + edit_objects on the chat type</span></p>

```json
{ "type": "incident_chat", "kind": "public", "name": "press-7-leak",
  "topic": "Hydraulic leak, Press 7", "object": "o4b8j2e6c0t1q5w9r3y7u2i6" }
```

| Field | |
|---|---|
| `type` | the chat type (required) |
| `kind` | `public`, `private`, `dm`, or `group_dm` (required) |
| `name` | for `public` and `private`: 1-80 characters of `a-z`, `0-9`, `-`, `_`, starting with a letter or digit |
| `topic` | up to 250 characters |
| `object` | an object of the chat type's `object_type` you can see, for a channel about it |
| `members` | user ids besides you: for a `dm` the other person, for a `group_dm` 2 to 8 others |

`201` with the channel; you are its first member. A direct message between
the same people already open returns that channel with `200`. Direct
messages take no `name`, `topic`, or `object` (`400`). `409` ("a public
channel with this name exists") if a new public channel's name is taken by
a live public channel of the chat type about the same object (or about no
object); private channels may repeat any name. `422` for an invalid name,
topic, member list, or object.

### GET /v1/chat/channels/{channel}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The channel.

### PATCH /v1/chat/channels/{channel}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member; renaming and archiving: the administrator</span></p>

```json
{ "topic": "Seal replaced, testing", "expected_version": 1 }
```

Members set the `topic`. The channel's administrator (its creator, or an
owner for a public channel) changes the `name` and `archived` (`403`
otherwise). Renaming a public channel to a name another live public
channel about the same object (or about no object) has is `409` ("a public
channel with this name exists"). With `expected_version`, `409` unless the
channel is at that version. Direct messages have no name or topic (`400`). Returns the
channel.

### DELETE /v1/chat/channels/{channel}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>the administrator</span></p>

Deletes the channel and everything in it, at once. `204`.

## Members

### POST /v1/chat/channels/{channel}/join

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit_objects on the chat type</span></p>

Joins a public channel and returns it. Other channels are joined by being
added (`400`).

### POST /v1/chat/channels/{channel}/leave

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

Leaves the channel. `204`. A private channel is hidden from you at once.
Direct messages keep their members (`400`).

### GET /v1/chat/channels/{channel}/members

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

```json
{ "members": [ { "id": "h3jd8s0q2l5x7c1v9b4n6m8k", "kind": "human", "display_name": "Tess" } ] }
```

`display_name` is shown with `view_members`.

### PUT /v1/chat/channels/{channel}/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

Adds an active member of the organization. `201`, or `204` if they were
already in it. Direct messages keep their members (`400`).

### DELETE /v1/chat/channels/{channel}/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>yourself; others: the administrator</span></p>

Removes a member. `204`.

## Messages

A message in responses:

```json
{
  "id": "m3s5g7e9a1b2c4d6e8f0g1h2",
  "channel": "c7h2a9n4n1e8l3x6q5w0e2r4",
  "seq": 2,
  "thread": null,
  "author": "a9g3e7n1t5b2o8t4q6w0e2r4",
  "text": "Assigned to <@h3jd8s0q2l5x7c1v9b4n6m8k>. Seal kit is in bay 3",
  "fields": { "kind": "update" },
  "version": 1,
  "created_at": "2026-10-26T09:02:00Z",
  "edited_at": null,
  "deleted": false,
  "deleted_at": null,
  "deleted_by": null,
  "reply_count": 0,
  "last_reply_at": null,
  "reactions": [ { "emoji": "+1", "count": 1, "users": ["h3jd8s0q2l5x7c1v9b4n6m8k"], "mine": false } ],
  "attachments": [ { "file": "f6i2l8e4i0d9x3c7v1b5n2m6", "name": "seal.pdf", "content_type": "application/pdf", "size_bytes": 182044 } ],
  "mentions": ["h3jd8s0q2l5x7c1v9b4n6m8k"],
  "pinned": false
}
```

`thread` is the id of the thread's first message, for a reply. A deleted
message keeps its `id` and `seq`, with no text, fields, reactions,
attachments, or mentions. Attachments are downloaded with
[`GET /v1/files/{file}`](/docs/api/organization/#get-v1-files-file).

### GET /v1/chat/channels/{channel}/messages

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

A page of messages, oldest first: `{"channel": ..., "messages": [...],
"more": true}`.

| Query | |
|---|---|
| `before` | messages before this `seq` (default: the newest page) |
| `after` | messages after this `seq` |
| `thread` | the replies of this thread (its first message's id); the response also carries the first message as `thread` |
| `limit` | 1-200, default 50 |

Without `thread`, the page holds top-level messages only. `before` and
`after` exclude each other.

### POST /v1/chat/channels/{channel}/messages

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member, with edit_objects on the chat type</span></p>

```json
{ "text": "Seal kit picked up. On my way", "fields": { "kind": "update" },
  "thread": "m1f2i3r4s5t6m7s8g9a0b1c2", "attachments": ["f6i2l8e4i0d9x3c7v1b5n2m6"],
  "idempotency_key": "tess-1" }
```

| Field | |
|---|---|
| `text` | up to 40,000 characters; `<@user id>` mentions someone |
| `fields` | values of the chat type's message fields |
| `thread` | reply in this thread: the id of its first message in this channel |
| `attachments` | up to 10 ids of files you can read |
| `idempotency_key` | 1-200 characters; the same post again returns the first message |

A message has text or attachments. `201` with the message, or `200` with
the first one for a repeated `idempotency_key`. `422` with paths `text`,
`fields.<name>`, `thread`, or `attachments[i]`.

### GET /v1/chat/messages/{message}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The message.

### PATCH /v1/chat/messages/{message}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>its author</span></p>

```json
{ "text": "Seal kit picked up. On site in 10 minutes", "expected_version": 1 }
```

Changes the `text` or `fields`. The earlier version goes to the history.
`409` for a deleted message, or one no longer at `expected_version`.
Returns the message.

### GET /v1/chat/messages/{message}/history

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

```json
{ "message": "m3s5g7e9a1b2c4d6e8f0g1h2",
  "versions": [
    { "version": 1, "text": "Seal kit picked up. On my way", "fields": {}, "written_at": "2026-10-26T09:05:00Z" },
    { "version": 2, "text": "Seal kit picked up. On site in 10 minutes", "fields": {},
      "written_at": "2026-10-26T09:06:00Z", "deleted": false } ] }
```

Every version, oldest first; the last is the current one.

### DELETE /v1/chat/messages/{message}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>its author, or the administrator</span></p>

Deletes the message, keeping its place. `204`, also if it was already
deleted.

## Reactions and pins

### PUT /v1/chat/messages/{message}/reactions/{emoji}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

Adds your reaction: an emoji, or a short name like `+1` (1-32 characters,
no spaces). `201`, or `204` if you had already reacted so. A message has at
most 50 different reactions.

### DELETE /v1/chat/messages/{message}/reactions/{emoji}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

Removes your reaction. `204`.

### GET /v1/chat/channels/{channel}/pins

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

`{"messages": [...]}`, the pinned messages.

### PUT /v1/chat/channels/{channel}/pins/{message}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

Pins a message. `201`, or `204` if it was pinned. At most 100 pins per
channel (`409`).

### DELETE /v1/chat/channels/{channel}/pins/{message}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

Unpins it. `204`.

## Read state, typing, mentions

### PUT /v1/chat/channels/{channel}/read

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

```json
{ "seq": 2 }
```

Marks the channel read up to `seq`. It never moves backward: a smaller
`seq` changes nothing. Returns `{"read_seq": 2, "unread": 0}`.

### POST /v1/chat/channels/{channel}/typing

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>a member</span></p>

Tells the channel's other readers that you are typing, as a `chat.typing`
[event](/docs/api/events/). Nothing is stored. `204`. Limited to 30 a
minute per user.

### GET /v1/chat/mentions

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects</span></p>

The messages that mention you, in the channels you can read, newest first:
`{"messages": [...], "next_before": ...}`. Each message also names its chat
`type`.

| Query | |
|---|---|
| `before` | mentions older than this time (pass `next_before`) |
| `limit` | 1-200, default 50 |
