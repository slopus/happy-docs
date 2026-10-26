---
layout: ../../../layouts/Docs.astro
title: Objects and links
lead: Create, read, change, query, and delete objects; follow and change links.
---

Objects are addressed by their type's `api_name` and their id. Every endpoint
here needs `view_objects` on the type; writes also need `edit_objects` on it.
A restricted type you cannot view is `404`, as is an object of another type.

## The object

```json
{
  "id": "o4b8j2e6c0t1q5w9r3y7u2i6",
  "type": "employee",
  "properties": { "name": "Ada", "email": "ada@acme.example", "started": "2026-01-05" },
  "version": 1,
  "validation": { "state": "valid", "rules_version": 3 },
  "created_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "updated_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "created_at": "2026-10-24T10:00:00Z",
  "updated_at": "2026-10-24T10:00:00Z"
}
```

`version` starts at 1 and grows with every change to the object. Schema
changes do not change it. `validation` is where the object stands against
its type's current rules: `valid`, `invalid` (with `errors`, each a `path`
and a `message`), or `pending` until the background job has checked it; see
[Versions and schema changes](/docs/concepts/ontology/#versions-and-schema-changes).
A write always leaves the object `valid`.

`properties` holds only the properties you may see. A
[restricted property](/docs/concepts/ontology/#restricted-properties) you may
not see is absent from every object, filter and sort here, and a write naming
it is refused as for a property that does not exist; one you may see but not
write may be sent back unchanged.

Objects of a [team type](/docs/concepts/ontology/#team-types) are teams.
Creating one creates the team, changing its `name` renames it (`409` if
another team has the name), and deleting it deletes the team.

## Pages

Lists and queries return a page:

```json
{ "data": [ { "id": "o4b8j2e6c0t1q5w9r3y7u2i6", "type": "employee", "...": "..." } ],
  "next_cursor": "eyJrIjpbIjIwMjYtMTAtMjRUMTA6MDA6MDBaIiwi..." }
```

`next_cursor` is `null` on the last page. Pass it back as `cursor` with the
same ordering to get the next one.

## Objects

### GET /v1/ontology/objects/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects on the type</span></p>

Lists objects. Query parameters, all optional:

| Parameter | |
|---|---|
| `limit` | 1-500, default 50 |
| `cursor` | `next_cursor` of the previous page |
| `order_by` | a scalar property, or `$id`, `$created_at`, `$updated_at` (default: `$id`) |
| `direction` | `asc` (default) or `desc` |

```sh
curl "$BASE/v1/ontology/objects/employee?order_by=started&direction=desc&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /v1/ontology/objects/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects and edit_objects on the type</span></p>

```json
{ "properties": { "name": "Ada", "email": "ada@acme.example", "started": "2026-01-05" } }
```

`201` with the object. The properties are checked against the type's current
definition, then its custom validators.

- `422 validation_failed`, one `details` entry per problem (`path`,
  `message`): missing required properties, unknown properties, wrong types,
  broken rules, unknown user or file ids, failed validators.
- `409` if a `unique` value is taken (the message names the property).
- `503 validators_unavailable` if the type uses validators and no sandbox is
  configured.

### POST /v1/ontology/objects/{type}/query

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects on the type</span></p>

Queries with a filter tree. All fields are optional.

```json
{
  "filter": {
    "op": "and",
    "filters": [
      { "op": "in", "property": "name", "values": ["Ada", "Grace", "Alan"] },
      { "op": "not", "filter": { "op": "is_null", "property": "email" } },
      { "op": "gte", "property": "started", "value": "2026-01-01" }
    ]
  },
  "order_by": { "property": "$created_at", "direction": "desc" },
  "limit": 100,
  "cursor": null
}
```

Returns a page. The operators are listed in
[The ontology](/docs/concepts/ontology/#queries); they apply to top-level
properties. `400` for a filter that does
not fit the type (an unknown property, a value of the wrong type, an ordering
on a non-scalar property) or exceeds the limits (100 conditions, 10 levels,
500 `in` values).

`linked` filters by links: `{ "op": "linked", "link": "projects", "object": "<project id>" }`
finds the objects linked to that project through this type's end named
`projects`. `{ "op": "validation", "state": "invalid" }` finds the objects
that fail the type's current rules.

### GET /v1/ontology/objects/{type}/{id}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects on the type</span></p>

The object.

### PATCH /v1/ontology/objects/{type}/{id}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects and edit_objects on the type</span></p>

Merges `properties` into the stored ones (`null` removes a property) and checks
the result. `expected_version` makes the change conditional.

```json
{ "properties": { "email": "ada@analytical.example", "started": null }, "expected_version": 1 }
```

Returns the object at its new version. Errors as for creation, plus `409` if
the object is no longer at `expected_version`.

### DELETE /v1/ontology/objects/{type}/{id}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects and edit_objects on the type</span></p>

Deletes the object, at once: it and its links disappear from every read
(one `link.deleted` event per link) and its unique values are free. The rows
are removed in the background. `204`.

## Links

### GET /v1/ontology/objects/{type}/{id}/links/{link}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects on both types</span></p>

The objects linked to this one through its link end named `link` (a link
type's `forward_name` from the source type, `reverse_name` from the target
type), as a page. `limit` and `cursor` work as for lists. `404` if the end
does not exist or leads to a type you cannot view.

```sh
curl "$BASE/v1/ontology/objects/employee/o4b8j2e6c0t1q5w9r3y7u2i6/links/projects" \
  -H "Authorization: Bearer $TOKEN"
```

### PUT /v1/ontology/links/{link}/{from}/{to}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects and edit_objects on both types</span></p>

Links the source object `from` to the target object `to` with the link type
`link` (its `api_name`). Idempotent: `201` when created, `200` when the link
existed. `409` if the link type's cardinality does not allow it (the message
names the cardinality; links of deleted objects do not count); `404` if
either object is not of the declared type. For a
[team hierarchy](/docs/concepts/ontology/#team-hierarchies), `409` if the link
would close a cycle; as for any link, it needs edit access to both teams.

```sh
curl -X PUT "$BASE/v1/ontology/links/works_on/o4b8j2e6c0t1q5w9r3y7u2i6/o9k3m7p1s5v2x6z0b4d8f2h6" \
  -H "Authorization: Bearer $TOKEN"
```

### DELETE /v1/ontology/links/{link}/{from}/{to}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects and edit_objects on both types</span></p>

Removes the link. `204`; `404` if it did not exist.
