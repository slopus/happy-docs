---
layout: ../../../layouts/Docs.astro
title: Chat
lead: A chat type holds channels of messages, for people and agents alike. Channels are public, private, or direct, and can be about one object, an incident's channel say, which is seen exactly by whoever sees that object. The database itself decides who sees a channel and everything in it.
---

A chat type is an object type of kind `chat`. It is part of the
[ontology](/docs/concepts/ontology/), with versions, access settings,
grants, and live events, but it holds **channels** of **messages** rather
than objects. The object, link and action APIs refuse it; channels and
messages have [their own endpoints](/docs/api/chat/).

```json
POST /v1/ontology/object-types
{
  "api_name": "incident_chat",
  "display_name": "Incident chat",
  "kind": "chat",
  "properties": [
    { "api_name": "kind", "type": { "kind": "string" },
      "rules": [{ "rule": "enum", "values": ["report", "update", "question"] }] }
  ],
  "chat": { "object_type": "incident", "retention_days": 365 }
}
```

Here every incident can have its own channel, messages are tagged as a
report, an update or a question, and threads are kept for a year.

## Message fields

The type's properties are optional **fields** of each message: up to 32 of
them, of kind `integer`, `double`, `boolean`, or `string`, with the
built-in [format rules](/docs/concepts/ontology/#format-rules) but not
`unique`, `sequence`, custom validators, or custom formats. A chat type may
have none. Fields are checked on every post and edit, and problems are
reported at `fields.<name>`.

## Channels

| Kind | Who sees it | Members |
|---|---|---|
| `public` | everyone who may read the chat type | anyone may join |
| `private` | its members | members add others |
| `dm` | its two members | fixed when it is opened |
| `group_dm` | its 3 to 9 members | fixed when it is opened |

- **Names** are 1-80 characters of lower-case letters, digits, `-` and `_`,
  starting with a letter or digit (`press-7-leak`). A public channel's name
  is unique among the chat type's live public channels about the same object
  (or about no object), which whoever creates or renames one already sees.
  Private channels may repeat any name, so a taken name never shows that a
  private channel exists. Channels also have a topic of up to 250
  characters.
- **Direct messages** have no name, topic, or object, and are opened once
  per set of members: opening the same conversation again returns the
  existing channel.
- **Channels about an object.** If the type names an `object_type` (which
  never changes), a channel may be about one of its objects. It is seen only
  while that object exists and is visible to the reader, so an incident's
  channel follows who sees the incident: a technician who sees only the
  incidents assigned to them sees only those incidents' channels.
- **Members.** A channel has up to 5,000 members, and its creator is one.
  Agent accounts take part like anyone else.
- **Administration.** The creator administers a channel: renames,
  archives, and deletes it, removes other members, and deletes others'
  messages. Organization owners administer public channels, and do not see
  private channels or direct messages they are not in. Members set the
  topic. An archived channel takes no writes.
- **Deletion.** Deleting a channel, or the object it is about, hides the
  channel and everything in it at once; the maintenance job removes the
  rows later. A chat type cannot be deleted while it has channels, and an
  object type cannot be deleted while a chat type refers to it (`409`).

## Who sees what

Postgres decides first. Row level security policies on every chat table
show a channel to a user only if it is public or they are a member, and only
while its object, if it has one, is visible to them. Everything in a channel
(its messages, their versions, reactions, mentions, attachments, pins, read
state, and its events) is seen only with the channel, and read state only
by its own user.

Then the API checks permissions:

- **Reading** needs `view_objects` on the chat type and, for a channel
  about an object, on the object's type.
- **Writing** (posting, reacting, pinning, typing, changing members or the
  topic) needs `edit_objects` on the chat type too, and membership. Posting
  in a public channel you have not joined is `409` ("join the channel
  first").
- **A channel you cannot read is `404`**, as if it did not exist.
- Leaving a private channel, or being removed from one, hides it at once.

Chat types take restricted access and grants like any type, but no
`access_properties` and no property restrictions.

## Messages

- **Order.** Each channel numbers its messages 1, 2, 3, ... (`seq`). Reads
  page by sequence number.
- **Threads** are one level deep: a reply names the first message of its
  thread, and the first message shows its `reply_count` and `last_reply_at`.
- **Text** is up to 40,000 characters. A message has text or attachments.
- **Mentions.** `<@user id>` in the text mentions an active member of the
  organization; `GET /v1/chat/mentions` lists the messages that mention you.
- **Attachments.** Up to 10 [files](/docs/concepts/files-and-email/) the
  poster may read. Whoever may read the message may then download them, and
  deleting the message ends that.
- **Retries.** An `idempotency_key` (per author and channel) makes a repeated
  post return the first message instead of posting twice.
- **Editing.** Only the author edits a message, optionally at an
  `expected_version`, and every earlier version is kept
  (`GET .../history`).
- **Deleting.** The author or the channel's administrator deletes a
  message. It keeps its place in the channel as a tombstone, and its text,
  fields, history, reactions, mentions, attachments, and pins are removed.
- **Reactions** are one per user and emoji (an emoji, or a short name like
  `+1`), up to 50 different ones per message. Reacting again changes
  nothing.
- **Pins.** Members pin up to 100 messages per channel.
- **Read state.** Each member's `read_seq` and `unread` count. Marking a
  channel read never moves backward.

Posts, reactions, and pins are [rate limited](/docs/concepts/rate-limits/)
per user.

## Retention

`retention_days` (1-36,500) hides a thread, its first message and its
replies together, once the first message is older than that. The
maintenance job deletes it more than an hour past the cutoff, so the
deletion never changes a read. Without `retention_days`, messages are kept.

## Live events

Every change is an [event](/docs/concepts/live-events/) on the
organization's stream, with the chat `type` and the `channel`:

| Event | Data |
|---|---|
| `chat.channel.created`, `chat.channel.changed` | the channel |
| `chat.channel.deleted` | |
| `chat.member.added`, `chat.member.removed` | `user`, `by` |
| `chat.message.created`, `chat.message.edited` | the message |
| `chat.message.deleted` | `id`, `seq`, `thread`, `by` |
| `chat.reaction.added`, `chat.reaction.removed` | `message`, `emoji`, `user` |
| `chat.pin.added`, `chat.pin.removed` | `message`, `by` |

An event reaches a subscriber only if they can read its channel when the
event is read. `GET /v1/ontology/events?channels=<ids>` narrows a stream to
some channels.

**Typing.** `POST .../typing` sends a `chat.typing` event, `{type, channel,
user}`, to the streams of the channel's other readers. It has no id, is
never stored, and never reaches the person typing.

## Through MCP

Assistants use chat with their own scopes: `chat:read` for
`list_channels` and `read_messages`, and `chat:write` (with `chat:read`) for
`post_message` and `add_reaction`. The chat scopes reach only chat, and
`ontology:read` and `ontology:write` do not reach chat, so a grant for one
never opens the other. See [MCP tools and scopes](/docs/api/mcp/#list_channels).

## Not there yet

- **Posts through MCP carry no attachments.**
- **Messages cannot be searched.**
