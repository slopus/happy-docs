---
layout: ../../../layouts/Docs.astro
title: Live events
lead: Every change to an organisation's ontology is appended to its outbox in the same transaction, and streamed to subscribers as server-sent events they can resume without gaps.
---

## The outbox

Every ontology write appends events to the organisation's outbox
(`ontology_events`) inside the write's own transaction, so an event exists
exactly when its change committed.

| Event | Payload |
|---|---|
| `object.created`, `object.updated` | `type`, `id`, `version`, `properties` |
| `object.deleted` | `type`, `id` |
| `link.created`, `link.deleted` | `link`, `from_type`, `from`, `to_type`, `to` |
| `type.created`, `type.changed`, `type.deleted` | `type`, `version` (`changed` also on access changes) |
| `type.validation` | `type`, `rules_version`, `state`, `objects`, `validated`, `invalid`: progress of the background validation |
| `link_type.created`, `link_type.changed`, `link_type.deleted` | `link`, `from_type`, `to_type` |

Schema changes never rewrite objects, so they emit only `type.changed`;
removed properties simply stop appearing in later events, and the background
validation of new rules reports its progress as `type.validation` after each
batch. Deleting an object or a link type emits `link.deleted` for each of its
visible links.

Each event has a **sequence number** from a per-organisation counter row. The
writer locks that row until it commits, so an organisation's events commit in
sequence order and a reader that has seen event *n* has seen everything
before it. Writers of one organisation serialise on the counter only for the
moment between their last statement and commit.

## Subscribing

```http
GET /v1/ontology/events?types=employee,project
Authorization: Bearer <token>
Accept: text/event-stream
```

```text
id: 1042
event: object.updated
data: {"type":"employee","id":"o4b8j2e6c0t1q5w9r3y7u2i6","version":3,"properties":{"name":"Ada","age":37}}

id: 1043
event: link.created
data: {"link":"works_on","from_type":"employee","from":"o4b8j2e6c0t1q5w9r3y7u2i6","to_type":"project","to":"o9k3m7p1s5v2x6z0b4d8f2h6"}
```

- Needs `view_objects`.
- `types` (object type api names) and `objects` (object ids), each
  comma-separated with up to 100 values, narrow the stream to events about
  any of them.
- Without a cursor, the stream starts at the next change.
- The SSE `id` is the event's sequence number. Reconnect with
  `Last-Event-ID: <id>` (browsers do this automatically) or `?after=<id>`
  to continue right after it.

## What a subscriber receives

Delivery is decided per event, when it is read, not when the stream opened.
Each read opens a fresh transaction re-authenticated with the stream's
credential, then:

- only the subscriber's own organisation's events exist for it (row level
  security plus an explicit `tenant_id` filter);
- an event goes out only if the subscriber may view, at that moment, **every**
  object type it is about. A link between an `employee` and a restricted
  `salary_band` is not delivered to someone who cannot view `salary_band`;
- an ended session, a deactivated user, or a lost `view_objects` ends the
  stream.

Streams wake on `NOTIFY ontology_events` (the payload is just the
organisation id) and also poll every 10 seconds, which bounds how long an
idle stream outlives a revoked session.

## Retention and limits

- Events are pruned after **7 days**. A cursor older than what was pruned gets
  a `reset` event; reload the data you care about, then continue from the
  stream:

  ```text
  event: reset
  data: {"reason":"events after the cursor were pruned; reload"}
  ```

- At most **20** open streams per user per replica; more get `429`.

The Lean model `proofs/HappyEnterprise/Live.lean` proves that a stream
delivers only its own organisation's events, only those about types its
subscriber may view when the event is read, and that resuming from a cursor
not older than what was pruned misses no event.
