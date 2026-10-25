---
layout: ../../../layouts/Docs.astro
title: Performance
lead: Measured reads, writes, live streams, and revalidation at 100,000, 300,000, and 1,000,000 objects of one type, on a 4-core machine. One run, no tuning; the numbers describe this machine and this setup, nothing more.
---

Measured on 2026-10-25. Everything measured goes through the HTTP API.

## In short

| | 100,000 | 300,000 | 1,000,000 |
|---|---|---|---|
| Get one object by id, p50 | 1.45 ms | 2.25 ms | 1.54 ms |
| Traverse a link, first 50, p50 | 3.72 ms | 5.60 ms | 6.70 ms |
| `linked` filter plus `eq`, p50 | 3.48 ms | 5.99 ms | 5.05 ms |
| `eq` on a 10% value, first page, p50 | 3.10 ms | 54 ms | 96 ms |
| Next page by cursor, p50 | 2.09 ms | 2.61 ms | 2.25 ms |
| `starts_with` on a property, p50 | 113 ms | 373 ms | 1.3 s |
| `order_by` a property, top 50, p50 | 250 ms | 755 ms | 2.3 s |
| Create objects, 8 clients | 828/s | 831/s | 939/s |
| Apply an action, 8 clients | 740/s | 645/s | 637/s |
| Catch up a live stream | 40,328 events/s | 47,669 events/s | 48,326 events/s |
| Rules change answered in | 316 ms | 994 ms | 2.5 s |

- **Lookups by id, link traversals, and `linked` filters** use indexes and
  stay in single-digit milliseconds at every size.
- **Filters and sorts on properties scan the type's objects.** There are no
  property indexes yet. Filters that find their first page early stay cheap;
  those that must look at every object, such as `starts_with` or `order_by`
  on a property, grow with the type.
- **Writes do not depend on the size**: about 800 object creations, 750
  links, or 650 actions per second with 8 clients on these 4 cores, and less
  with 32, as the clients contend for the cores and the 20 pooled
  connections. Actions refuse a concurrent change to an object they read
  with `409 version_conflict` by design; with random targets among this many
  objects, none occurred.
- **A type's `validation` summary counts every object of the type**, so a
  schema change that changes the rules takes longer to answer as the type
  grows, without reading any object's data.
- **Catching up a live stream** ran at 40,000 to 48,000 events per second,
  the first event within 20 ms, at every size.

### Revalidation

In this run, revalidation after a rules change was **quadratic**: after each
batch the job recounted the whole type for its progress event. Its rate fell
from 521 objects/s at 120,000 objects to 217 at 320,000 and 79 at 1,000,000,
where 30 minutes covered 14% of the type. This has since been fixed: the job
now walks the type once and reports progress at most once a second, so
revalidation is linear. Measurements after the fix will be published here.

## Machine

| | |
|---|---|
| CPU | AMD EPYC 9554P, 4 vCPUs |
| Memory | 16 GiB |
| OS | Linux 6.12 |
| Disk | ext4 on a virtual disk |
| Postgres | 18.6 over a unix socket, default settings: `shared_buffers` 128MB, `work_mem` 4MB, `synchronous_commit` on |
| Server | release build, 20 connections in the organization API's pool, `RUST_LOG=warn`, custom validators off |

The server, Postgres, and the benchmark client share these cores, and HTTP
goes over loopback TCP.

## Setup

One organization with two object types: `asset` (`name`, a `status` enum,
`priority` an integer 1-5, `cost` a double, `site_code`) and `site` (`code`,
a `region` enum). Each asset has a `many_to_one` link to one of a hundredth
as many sites, and the writes add `many_to_many` links between assets. The
bulk of each size is inserted directly into Postgres in the form the API
stores, then `ANALYZE`d. Each size's revalidation rechecks every object, the
bulk ones included.

- **Reads** come from one sequential client, an agent with `view_objects`
  and an API token, so row level security and the object access policy
  apply: 200 calls each after a warm-up, or as many as fit in a minute
  (`n` below). Their parameters are spread over the bulk objects.
- **Writes** come from the owner, with a session token. Each client sends its
  next request when the last one answers; each run lasts 10 seconds.

## Results

### 100,000 assets

Before the runs: 100000 assets, 1000 sites, 100000 links, 4 events; database 147 MiB. Bulk top-up took 7.5 s.

Reads, one client, as an agent with `view_objects` (ms):

| Read | Call | n | p50 | p99 | max | rows/call |
|---|---|---|---|---|---|---|
| get one object | `GET /v1/ontology/objects/asset/{id}` | 200 | 1.45 | 5.20 | 11 | 1 |
| `eq` status = down (10%), first 50 by id | `query` | 200 | 3.10 | 11 | 17 | 50 |
| `eq` status = running, page 2 (cursor) | `query` with the first page's cursor | 200 | 2.09 | 3.77 | 4.05 | 50 |
| `and` priority = 5, cost >= 990 (0.2%) | `query` | 200 | 71 | 110 | 182 | 50 |
| `starts_with` a name prefix (~100 matches at 10^6) | `query` | 200 | 113 | 243 | 263 | 50 |
| `order_by` cost desc, top 50 of all | `query` | 200 | 250 | 312 | 322 | 50 |
| `linked` to one site and `eq` status = running | `query` | 200 | 3.48 | 8.02 | 9.92 | 35 |
| traverse asset -> site | `GET .../asset/{id}/links/site` | 200 | 2.11 | 3.76 | 4.78 | 1 |
| traverse site -> assets, first 50 | `GET .../site/{id}/links/assets` | 200 | 3.72 | 4.82 | 8.11 | 50 |

Writes as the owner, 10 s per run:

| Write | Clients | ops/s | p50 ms | p99 ms | errors |
|---|---|---|---|---|---|
| create an object | 1 | 473 | 1.93 | 4.88 | 0 |
| create an object | 8 | 828 | 6.42 | 51 | 0 |
| create an object | 32 | 733 | 33 | 178 | 0 |
| create a link | 1 | 291 | 3.11 | 7.95 | 0 |
| create a link | 8 | 855 | 7.58 | 33 | 0 |
| create a link | 32 | 780 | 32 | 148 | 0 |
| apply an action (1 criterion, 1 update) | 1 | 230 | 3.98 | 9.76 | 0 |
| apply an action (1 criterion, 1 update) | 8 | 740 | 8.87 | 38 | 0 |
| apply an action (1 criterion, 1 update) | 32 | 580 | 43 | 203 | 0 |

Live-stream catch-up: a new stream with a cursor from before the writes received their 70719 events in 1.75 s (40328 events/s; first after 11 ms).

Revalidation (before the fix): a rules change (`max` on `cost`) answered in 316 ms; the maintenance job then rechecked all 120384 assets, every one valid, in 231 s (521 objects/s).

### 300,000 assets

Before the runs: 300000 assets, 3000 sites, 298901 links, 71326 events; database 519 MiB. Bulk top-up took 16.1 s.

Reads, one client, as an agent with `view_objects` (ms):

| Read | Call | n | p50 | p99 | max | rows/call |
|---|---|---|---|---|---|---|
| get one object | `GET /v1/ontology/objects/asset/{id}` | 200 | 2.25 | 5.87 | 9.17 | 1 |
| `eq` status = down (10%), first 50 by id | `query` | 200 | 54 | 82 | 92 | 50 |
| `eq` status = running, page 2 (cursor) | `query` with the first page's cursor | 200 | 2.61 | 6.19 | 8.70 | 50 |
| `and` priority = 5, cost >= 990 (0.2%) | `query` | 200 | 128 | 166 | 198 | 50 |
| `starts_with` a name prefix (~100 matches at 10^6) | `query` | 170 | 373 | 716 | 727 | 50 |
| `order_by` cost desc, top 50 of all | `query` | 79 | 755 | 950 | 950 | 50 |
| `linked` to one site and `eq` status = running | `query` | 200 | 5.99 | 25 | 40 | 35 |
| traverse asset -> site | `GET .../asset/{id}/links/site` | 200 | 3.38 | 8.47 | 9.99 | 1 |
| traverse site -> assets, first 50 | `GET .../site/{id}/links/assets` | 200 | 5.60 | 14 | 16 | 50 |

Writes as the owner, 10 s per run:

| Write | Clients | ops/s | p50 ms | p99 ms | errors |
|---|---|---|---|---|---|
| create an object | 1 | 302 | 2.92 | 8.91 | 0 |
| create an object | 8 | 831 | 6.95 | 40 | 0 |
| create an object | 32 | 803 | 30 | 152 | 0 |
| create a link | 1 | 224 | 4.24 | 11 | 0 |
| create a link | 8 | 779 | 8.03 | 41 | 0 |
| create a link | 32 | 617 | 40 | 189 | 0 |
| apply an action (1 criterion, 1 update) | 1 | 226 | 3.94 | 11 | 0 |
| apply an action (1 criterion, 1 update) | 8 | 645 | 10 | 47 | 0 |
| apply an action (1 criterion, 1 update) | 32 | 554 | 45 | 200 | 0 |

Live-stream catch-up: a new stream with a cursor from before the writes received their 64220 events in 1.35 s (47669 events/s; first after 16 ms).

Revalidation (before the fix): a rules change (`max` on `cost`) answered in 994 ms; the maintenance job then rechecked all 319394 assets, every one valid, in 1471 s (217 objects/s).

### 1,000,000 assets

Before the runs: 1000000 assets, 10000 sites, 995739 links, 137144 events; database 1672 MiB. Bulk top-up took 55.3 s.

Reads, one client, as an agent with `view_objects` (ms):

| Read | Call | n | p50 | p99 | max | rows/call |
|---|---|---|---|---|---|---|
| get one object | `GET /v1/ontology/objects/asset/{id}` | 200 | 1.54 | 4.04 | 4.27 | 1 |
| `eq` status = down (10%), first 50 by id | `query` | 200 | 96 | 140 | 256 | 50 |
| `eq` status = running, page 2 (cursor) | `query` with the first page's cursor | 200 | 2.25 | 5.18 | 5.80 | 50 |
| `and` priority = 5, cost >= 990 (0.2%) | `query` | 200 | 173 | 213 | 277 | 50 |
| `starts_with` a name prefix (~100 matches at 10^6) | `query` | 47 | 1308 | 2219 | 2219 | 50 |
| `order_by` cost desc, top 50 of all | `query` | 27 | 2260 | 2541 | 2541 | 50 |
| `linked` to one site and `eq` status = running | `query` | 200 | 5.05 | 11 | 19 | 35 |
| traverse asset -> site | `GET .../asset/{id}/links/site` | 200 | 2.96 | 10 | 10 | 1 |
| traverse site -> assets, first 50 | `GET .../site/{id}/links/assets` | 200 | 6.70 | 14 | 15 | 50 |

Writes as the owner, 10 s per run:

| Write | Clients | ops/s | p50 ms | p99 ms | errors |
|---|---|---|---|---|---|
| create an object | 1 | 381 | 2.36 | 6.04 | 0 |
| create an object | 8 | 939 | 5.70 | 40 | 0 |
| create an object | 32 | 779 | 31 | 157 | 0 |
| create a link | 1 | 228 | 3.79 | 12 | 0 |
| create a link | 8 | 740 | 8.80 | 38 | 0 |
| create a link | 32 | 625 | 40 | 191 | 0 |
| apply an action (1 criterion, 1 update) | 1 | 212 | 4.12 | 13 | 0 |
| apply an action (1 criterion, 1 update) | 8 | 637 | 10 | 44 | 0 |
| apply an action (1 criterion, 1 update) | 32 | 655 | 38 | 173 | 0 |

Live-stream catch-up: a new stream with a cursor from before the writes received their 67112 events in 1.39 s (48326 events/s; first after 12 ms).

Revalidation (before the fix): a rules change (`max` on `cost`) answered in 2480 ms; the maintenance job had rechecked 142600 of 1021024 assets when the run stopped waiting, after 1805 s (79 objects/s).

