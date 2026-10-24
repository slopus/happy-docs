---
layout: ../../../layouts/Docs.astro
title: Event stream
lead: Server-sent events for every ontology change you may see, resumable by sequence number.
---

See [Live events](/docs/concepts/live-events/) for delivery guarantees.

### GET /v1/ontology/events

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects; each event needs view access to every type it is about</span></p>

Opens a `text/event-stream`.

| Parameter | |
|---|---|
| `after` | resume after this sequence number |
| `types` | comma-separated object type api names: events about any of them |
| `objects` | comma-separated object ids: events about any of them |

`Last-Event-ID` (the header browsers send when an `EventSource` reconnects)
takes precedence over `after`. Without either, the stream starts at the next
change. `types` and `objects` take up to 100 values each.

```sh
curl -N "$BASE/v1/ontology/events?types=employee" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Last-Event-ID: 1041"
```

```text
id: 1042
event: object.created
data: {"type":"employee","id":"o4b8j2e6c0t1q5w9r3y7u2i6","version":1,"properties":{"name":"Ada"}}

id: 1043
event: object.updated
data: {"type":"employee","id":"o4b8j2e6c0t1q5w9r3y7u2i6","version":2,"properties":{"name":"Ada","age":36}}

id: 1047
event: object.deleted
data: {"type":"employee","id":"o4b8j2e6c0t1q5w9r3y7u2i6"}
```

Sequence numbers are per organization and gap-free in the outbox; a stream
skips the ones you may not see or filtered out, so the ids you receive can
jump.

### Event kinds

| `event` | `data` |
|---|---|
| `object.created`, `object.updated` | `{type, id, version, properties}` |
| `object.deleted` | `{type, id}` |
| `link.created`, `link.deleted` | `{link, from_type, from, to_type, to}` |
| `type.created`, `type.changed`, `type.deleted` | `{type, version}` |
| `type.validation` | `{type, rules_version, state, objects, validated, invalid}`: the background job's progress against new rules |
| `link_type.created`, `link_type.changed`, `link_type.deleted` | `{link, from_type, to_type}` |
| `reset` (no `id`) | `{reason}`: your cursor is older than the 7 days kept; reload, then carry on |

### Ending

The stream ends when your session ends, you are deactivated, or you lose
`view_objects`; it is re-authenticated before every read and at least every
10 seconds. Reconnect with the last `id` you saw.

### Limits

At most 20 open streams per user on each server replica; beyond that,
opening one is `429`.

### From a browser

`EventSource` cannot send an `Authorization` header, so use a streaming
`fetch` (or an `EventSource` polyfill that supports headers):

```js
const headers = { Authorization: `Bearer ${token}` };
if (lastId) headers['Last-Event-ID'] = lastId;
const res = await fetch(`${BASE}/v1/ontology/events?types=employee`, { headers });
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  // parse "id:", "event:", "data:" lines separated by blank lines
}
```
