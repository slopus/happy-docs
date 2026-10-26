---
layout: ../../../layouts/Docs.astro
title: Timeseries
lead: Write points to the series of a timeseries type, read them raw, in buckets, or downsampled, get each series' newest point, list series, and read the ingest log.
---

[Timeseries](/docs/concepts/timeseries/) explains series, fields,
retention, and who may read and write them. Timeseries types are created
and changed with the [ontology schema](/docs/api/ontology-schema/#timeseries-types)
endpoints and addressed here by their `api_name`. These endpoints answer
`400` for a type that is not a timeseries type, `404` for one you cannot
read, and `403` without `view_objects` (or, to write, `edit_objects`). Times
are RFC 3339; responses give them to the microsecond.

## Selecting series

Reads select series by any of:

| Field | |
|---|---|
| `series` | a list of series ids |
| `object` | the id of the series' object |
| `tags` | tag values the series must have, such as `{"sensor": "spindle"}`; other tags may have any value |

Leaving all of them out selects every series you may read. A read covers at
most 100 series: naming more ids is `400`, and so is a selection that
matches more ("name the series, an object, or tags"). An unknown tag is
`422` at `tags`.

## Writing

### POST /v1/ontology/timeseries/{type}/points

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects + edit_objects on the timeseries type, and a view of each object</span></p>

```json
{
  "series": [
    { "object": "o4b8j2e6c0t1q5w9r3y7u2i6", "tags": { "sensor": "spindle" },
      "points": [
        { "at": "2026-10-26T09:00:00Z", "values": { "temperature": 41.5, "rpm": 1200, "running": true } },
        { "at": "2026-10-26T09:00:10Z", "values": { "temperature": 41.7, "rpm": 1210, "running": true } }
      ] }
  ],
  "idempotency_key": "saw-2026-10-26T09:00"
}
```

`object` is required when the type has an `object_type` and refused when it
has none; `tags` may name only the type's tags. `values` maps fields to
values. `idempotency_key` is optional, 1-200 characters.

`201`:

```json
{
  "batch_id": "b3a7t9c1h5i2d8x4q6w0e2r4",
  "type": "telemetry",
  "series": [
    { "id": "s1e3r5i7e9s0i2d4x6c8v0b2", "object": "o4b8j2e6c0t1q5w9r3y7u2i6",
      "tags": { "sensor": "spindle" }, "points": 2 }
  ],
  "points": 2,
  "inserted": 2,
  "replaced": 0,
  "unchanged": 0,
  "replayed": false
}
```

A point at a time its series already has replaces the stored one
(`replaced`), or changes nothing if its values are the same (`unchanged`).

| Status | `code` | When |
|---|---|---|
| `201` | | written |
| `200` | | a retry with the same `idempotency_key` and request: the first result, with `replayed: true`; nothing is written |
| `400` | `bad_request` | more than 1,000 series or 10,000 points, or a malformed body |
| `403` | `forbidden` | no write access to the type |
| `409` | `idempotency_conflict` | the key was used for a different request |
| `422` | `validation_failed` | one detail per problem, with paths such as `series[0].points[3].at` or `series[0].points[3].values.temperature`: a point twice in the batch, a point with no values, a value that fails its field, a time before the retention cutoff or more than a day ahead, an object you cannot see, an unknown tag |
| `413` | | a body over 8 MiB |
| `429` | `rate_limited` | too many batches; see [Rate limits](/docs/concepts/rate-limits/) |

The whole batch is refused if any point is. With `live` on, the batch emits
one `series.points` [event](/docs/api/events/) per series it changed.

## Reading

### POST /v1/ontology/timeseries/{type}/query

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects + a view of the series</span></p>

| Field | |
|---|---|
| `series`, `object`, `tags` | the [selection](#selecting-series) |
| `fields` | the fields to return (default all); an unknown one is `400` |
| `from`, `to` | the time range `[from, to)`; by default from the retention cutoff to a day ahead |
| `bucket` | aggregate per bucket: seconds, or `"30s"`, `"5m"`, `"1h"`, `"1d"` (1 second to 366 days), aligned to the Unix epoch |
| `aggregates` | with `bucket` or `max_points`: any of `avg`, `min`, `max`, `sum` (numbers), `count`, `first`, `last` (any field) |
| `max_points` | 2-10,000: downsample `[from, to)` to at most that many buckets per series; needs `from` and `to` |
| `limit` | raw reads: 1-10,000, default 1,000 |
| `cursor` | raw reads: `next_cursor` of the previous page |

`bucket` and `max_points` exclude each other. Without either, the read
returns **raw points**, by series and time:

```json
{
  "series": [
    { "id": "s1e3r5i7e9s0i2d4x6c8v0b2", "object": "o4b8j2e6c0t1q5w9r3y7u2i6",
      "tags": { "sensor": "spindle" }, "created_at": "2026-10-26T09:00:01.482113Z" }
  ],
  "points": [
    { "series": "s1e3r5i7e9s0i2d4x6c8v0b2", "at": "2026-10-26T09:00:00.000000Z",
      "values": { "temperature": 41.5, "rpm": 1200, "running": true } }
  ],
  "next_cursor": null
}
```

With `bucket` or `max_points`, it returns **buckets**, one per series and
bucket that has points:

```json
{
  "series": [ { "id": "s1e3r5i7e9s0i2d4x6c8v0b2", "...": "..." } ],
  "bucket_seconds": 60,
  "buckets": [
    { "series": "s1e3r5i7e9s0i2d4x6c8v0b2",
      "start": "2026-10-26T09:00:00.000000Z", "end": "2026-10-26T09:01:00.000000Z", "points": 6,
      "values": {
        "temperature": { "avg": 42.1, "min": 41.5, "max": 42.9 },
        "running": { "last": true } } }
  ]
}
```

Without `aggregates`, numbers get `avg`, `min`, and `max`, and other fields
`last`; with them, each field gets the ones that apply to it (`400` if none
applies to any). A read over more than 10,000 buckets in all, counting every
series, is `400`: use wider buckets, a shorter range, or fewer series.

### POST /v1/ontology/timeseries/{type}/latest

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects + a view of the series</span></p>

```json
{ "object": "o4b8j2e6c0t1q5w9r3y7u2i6", "fields": ["temperature"] }
```

Takes the [selection](#selecting-series) and `fields`, nothing else. Each
selected series with its newest point, or `null` if it has none left:

```json
{
  "series": [
    { "id": "s1e3r5i7e9s0i2d4x6c8v0b2", "object": "o4b8j2e6c0t1q5w9r3y7u2i6",
      "tags": { "sensor": "spindle" }, "created_at": "2026-10-26T09:00:01.482113Z",
      "latest": { "at": "2026-10-26T09:05:50.000000Z", "values": { "temperature": 43.2 } } }
  ]
}
```

### GET /v1/ontology/timeseries/{type}/series

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects + a view of the series</span></p>

The series you may read, by id, a page at a time.

| Query | |
|---|---|
| `object` | only the series of this object |
| `tag.<name>` | only series with this tag value, such as `tag.sensor=spindle` |
| `limit` | 1-500, default 100 |
| `cursor` | `next_cursor` of the previous page |

```json
{ "data": [ { "id": "s1e3r5i7e9s0i2d4x6c8v0b2", "object": "o4b8j2e6c0t1q5w9r3y7u2i6",
              "tags": { "sensor": "spindle" }, "created_at": "2026-10-26T09:00:01.482113Z" } ],
  "next_cursor": null }
```

## The ingest log

### GET /v1/ontology/timeseries/{type}/batches

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology and a view of the whole type</span></p>

Every batch written to the type, newest first.

| Query | |
|---|---|
| `before` | only batches written before this time: pass the last `created_at` of the previous page |
| `limit` | 1-500, default 100 |

```json
{
  "data": [
    { "id": "b3a7t9c1h5i2d8x4q6w0e2r4",
      "written_by": { "id": "a9g3e7n1t5b2o8t4q6w0e2r4", "kind": "agent", "method": "api_token", "via": "rest" },
      "series": 1, "points": 2, "inserted": 2, "replaced": 0,
      "first_at": "2026-10-26T09:00:00.000000Z", "last_at": "2026-10-26T09:00:10.000000Z",
      "created_at": "2026-10-26T09:00:01.482113Z" }
  ]
}
```

`method` is `session`, `oauth`, `external_jwt`, or `api_token`; `via` is
`rest` or `mcp`. Replays are not batches and are not listed.
