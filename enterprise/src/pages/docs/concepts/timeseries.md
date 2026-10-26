---
layout: ../../../layouts/Docs.astro
title: Timeseries
lead: A timeseries type holds series of timestamped points instead of objects, such as sensor readings, metrics, or prices. Each series can belong to an object and is read under that object's access. Points are written in idempotent batches, read raw, in buckets, or as the newest value, and kept for as long as the type's retention says.
---

A timeseries type is an object type of kind `timeseries`. It is part of the
[ontology](/docs/concepts/ontology/) like any other type, with versions,
access settings, grants, and live events, but it holds **series** of
**points** rather than objects. The object, link and action APIs refuse it
(`400`); points have [their own endpoints](/docs/api/timeseries/).

```json
POST /v1/ontology/object-types
{
  "api_name": "telemetry",
  "display_name": "Telemetry",
  "kind": "timeseries",
  "properties": [
    { "api_name": "temperature", "type": { "kind": "double" }, "unit": "°C",
      "rules": [{ "rule": "min", "value": -50 }, { "rule": "max", "value": 200 }] },
    { "api_name": "rpm", "type": { "kind": "integer" }, "unit": "rpm" },
    { "api_name": "running", "type": { "kind": "boolean" } },
    { "api_name": "mode", "type": { "kind": "string" },
      "rules": [{ "rule": "enum", "values": ["idle", "cut"] }] }
  ],
  "timeseries": { "object_type": "machine", "tags": ["sensor"], "retention_days": 30, "live": true }
}
```

Here every machine has its telemetry, one series per sensor, kept for 30
days and streamed as it arrives.

## Fields

The type's properties are the **fields** of each point: 1 to 64 of them, of
kind `integer`, `double`, `boolean`, or `string`. They take the built-in
[format rules](/docs/concepts/ontology/#format-rules) (`min`, `max`,
`length`, `regex`, `enum`, and the built-in formats), but not `unique`,
`sequence`, custom validators, or custom formats. A number may carry a
`unit` (1-32 characters, such as `°C` or `kWh`), a label for readers, not a
rule.

A point has at least one value, and every field marked `required`. Removing
a field hides its values at once; they stay in the stored points until
retention removes them.

## Series

A series is a time-ordered list of points, identified by:

- **its object**, if the type names an `object_type`: an object of that type,
  such as the machine the readings come from; and
- **its tags**: values for the tags the type declares (up to 16 tags, values
  of 1-200 characters), such as `{"sensor": "spindle"}`.

If the type names an `object_type`, every series belongs to an object of
it; if not, none does. A series is created the first time a point is
written to it and gets an id. The `object_type` of a timeseries type never changes, and tags can only
be added, so a series always means the same thing.

## Writing points

Points are written in **batches**: at most 10,000 points across at most
1,000 series, in a body of at most 8 MiB.

```json
POST /v1/ontology/timeseries/telemetry/points
{
  "series": [
    { "object": "<saw>", "tags": { "sensor": "spindle" },
      "points": [
        { "at": "2026-10-26T09:00:00Z", "values": { "temperature": 41.5, "rpm": 1200, "running": true } },
        { "at": "2026-10-26T09:00:10Z", "values": { "temperature": 41.7, "rpm": 1210, "running": true } } ] }
  ],
  "idempotency_key": "saw-2026-10-26T09:00"
}
```

- **A point is keyed by its series and its time.** Writing a point at an
  existing time replaces the earlier one, so sending the same batch again
  changes nothing. The result counts what was `inserted`, `replaced`, and
  `unchanged`.
- **A batch is all or nothing.** It is refused (`422`, with a path for each
  problem) if any point appears twice in it, has a value that fails its
  field, is older than the retention cutoff (or before 1970) or more than a
  day in the future, or names an object the writer cannot see.
- **Retries are safe.** With an `idempotency_key` (per user and type, kept
  for 7 days), repeating the same request returns its first result with
  `200` and `replayed: true`, and writes nothing. The same key with a
  different request is `409 idempotency_conflict`.
- **Every batch is recorded** in the type's ingest log: who wrote it, how
  (session, API token, OAuth, REST or MCP), how many series and points,
  what changed, and the time range.

Ingest is [rate limited](/docs/concepts/rate-limits/) per organization and
per user.

## Reading points

A read selects series by id, by object, or by tag values (at most 100
series per read), and optionally some fields:

- **Raw points** in `[from, to)`, ordered by series and time, a page at a
  time (`limit` 1-10,000, default 1,000, with a cursor).
- **Buckets.** With `bucket`, points are aggregated per series and bucket.
  A bucket is a number of seconds or a string like `"30s"`, `"5m"`, `"1h"`,
  or `"1d"`, up to 366 days, and buckets are aligned to the Unix epoch, so
  the same bucket always covers the same time. `aggregates` picks from
  `avg`, `min`, `max`, `sum` (numbers) and `count`, `first`, `last` (any
  field); by default numbers get `avg`, `min`, and `max`, and other fields
  `last`. Only buckets with points are returned.
- **Downsampling.** `max_points` splits `[from, to)` into at most that many
  buckets per series, for a chart of a given width.
- **The newest point** of each series, with `latest`: a machine's current
  temperature.

A read covers at most 10,000 buckets in all, across its series.

## Retention

`retention_days` (1-36,500) keeps points for that long. Older points are
hidden from every read at once, and the maintenance job deletes them later,
more than an hour past the cutoff, so the deletion never changes a read.
Writes older than the cutoff are refused.

What retention hid never comes back: shortening retention and then
lengthening it again does not bring the hidden points back. Without
`retention_days`, points are kept until their series goes.

## Access

Points follow the same access as everything else in the ontology, with
series of an object following that object:

- **Reading** needs `view_objects` and either view access to the timeseries
  type (it is unrestricted, or the reader's team has a grant on it) or, if
  the type **inherits its objects' access**, view access to its object type.
  Owners set `inherit_object_access` with the type's access settings.
- **A series of an object** is readable only while that object is live and
  visible to the reader. A technician who sees only their own machines,
  through [assigned access](/docs/concepts/ontology/#shared-and-assigned-objects),
  sees only those machines' telemetry.
- **Series a reader cannot read do not exist for them**: they are absent
  from listings, reads, and events, and naming one finds nothing.
- **Writing** needs `edit_objects` and the timeseries type's own view and
  edit access, never inherited, and a view of each object written to. A
  writer can always read what they write.
- Timeseries types take no `access_properties` and no
  [restricted properties](/docs/concepts/ontology/#restricted-properties).

## Live events

With `live` on, each batch emits one `series.points`
[event](/docs/concepts/live-events/) for every series whose points it
inserted or changed, with the first 100 of those points:

```json
{ "type": "telemetry", "series": "<series id>", "object": "<saw>", "tags": { "sensor": "spindle" },
  "count": 2, "first_at": "2026-10-26T09:00:00.000000Z", "last_at": "2026-10-26T09:00:10.000000Z",
  "points": [ { "at": "2026-10-26T09:00:00.000000Z", "values": { "temperature": 41.5, "rpm": 1200, "running": true } }, "..." ],
  "truncated": false }
```

An event reaches exactly the subscribers who could read its series when the
event is read. A batch that changed nothing emits nothing.

## Deletion

Deleting an object removes its series at once, and deleting a timeseries
type removes all of its series; the maintenance job deletes the rows later.
An object type cannot be deleted while a live timeseries type refers to it
(`409`).

There is no endpoint yet to delete single points: they go with retention,
or with their series.

## Through MCP

Assistants read series with `query_timeseries` and `latest_points`
(`ontology:read`) and write points with `write_points` (`ontology:write`),
through the same code as the REST API. See
[MCP tools and scopes](/docs/api/mcp/#query_timeseries).
