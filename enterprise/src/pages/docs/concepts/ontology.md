---
layout: ../../../layouts/Docs.astro
title: The ontology
lead: Each organization describes its own data as object types with typed properties and link types between them. Every write is checked against the current definition; new rules apply to stored data in the background, and deletions are instant.
---

The ontology is per organization, stored in tables scoped to the organization
like everything else. It has four parts:

- **Object types**, such as `employee` or `project`, each with a list of
  typed properties and format rules. Their definitions are versioned.
- **Objects**: JSON property values of one type.
- **Link types**, such as `works_on` from `employee` to `project`, with a
  cardinality and a name for each end.
- **Links** between two objects.

## Object types

An object type has an `api_name` (`[a-z][a-z0-9_]{0,62}`), a `display_name`
(1-200 characters), a `description` (up to 2000), and up to 200 properties.

```json
{
  "api_name": "employee",
  "display_name": "Employee",
  "properties": [
    { "api_name": "name", "type": { "kind": "string" }, "required": true,
      "rules": [{ "rule": "length", "min": 1, "max": 100 }] },
    { "api_name": "email", "type": { "kind": "string" },
      "rules": [{ "rule": "email" }, { "rule": "unique" }] },
    { "api_name": "age", "type": { "kind": "integer" }, "rules": [{ "rule": "min", "value": 16 }] },
    { "api_name": "manager", "type": { "kind": "user_ref" } },
    { "api_name": "tags", "type": { "kind": "array", "items": { "type": { "kind": "string" } } } }
  ]
}
```

A property has an `api_name`, an optional `display_name` and `description`,
a `type`, `required` (default `false`), and `rules`. The server gives each
property and struct field an `id` that survives renames (see
[Property ids](#property-ids)).

### Property types

| `kind` | Values |
|---|---|
| `string` | any JSON string |
| `integer` | a JSON integer |
| `double` | a JSON number |
| `boolean` | `true` or `false` |
| `date` | `YYYY-MM-DD` |
| `timestamp` | RFC 3339; stored normalized to UTC |
| `geo_point` | `{ "lat": -90..90, "lon": -180..180 }` |
| `file_ref` | the id of a file of this organization, checked on write |
| `user_ref` | the id of a user of this organization, checked on write |
| `array` | `{ "kind": "array", "items": { "type": ..., "rules": [...] } }`: elements of one type, each with its own rules |
| `struct` | `{ "kind": "struct", "fields": [ properties... ] }`: a nested object |

Arrays and structs nest at most 4 deep.

### Format rules

| `rule` | Applies to | Meaning |
|---|---|---|
| `min` `{value}`, `max` `{value}` | numbers | inclusive bounds |
| `length` `{min?, max?}` | strings, arrays | characters of a string, elements of an array |
| `regex` `{pattern}` | strings | Rust `regex` syntax, at most 1000 characters and size-limited when compiled; the whole string must match, so anchor it yourself |
| `enum` `{values}` | strings, integers | one of up to 500 values |
| `email` | strings | an email address |
| `url` | strings | an absolute `http` or `https` URL |
| `uuid`, `cuid` | strings | a UUID, a cuid2 |
| `unique` | top-level scalar properties other than booleans | no two objects of the type share the value |
| `validator` `{name, version}` | any type, including nested values | a [custom validator](/docs/concepts/validators/) |

A property may have up to 20 rules. Rules that do not fit their type (`email`
on an integer, an invalid regex) are refused with the definition, every
problem listed in a `422 validation_failed`.

## Objects

An object is the JSON map of its properties, plus metadata:

```json
{
  "id": "o4b8j2e6c0t1q5w9r3y7u2i6",
  "type": "employee",
  "properties": { "name": "Ada", "email": "ada@acme.example", "age": 36 },
  "version": 1,
  "validation": { "state": "valid", "rules_version": 3 },
  "created_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "updated_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "created_at": "2026-10-24T10:00:00Z",
  "updated_at": "2026-10-24T10:00:00Z"
}
```

Every write is checked against the type's **current** definition, which the
write holds `FOR SHARE` until it commits, so a schema change cannot slip in
between the check and the commit.

- `null` means absent. Required properties must be present.
- Unknown properties are refused.
- `PATCH` merges the given properties into the stored ones (`null` removes
  one) and checks the result.
- `expected_version` makes a write conditional: if the object has moved on,
  the write is a `409`.
- A `unique` value another object of the type holds is a `409` naming the
  property.

A failed check is a `422 validation_failed` with one entry per problem, each
with a `path` into the object and a `message`.

## Versions and schema changes

Replacing a type's definition (`PUT /v1/ontology/object-types/{type}`) bumps
its `version`, and every version is kept (`GET .../versions`).

A schema change never reads the stored objects and is never refused because
of them. New rules apply **at once to writes** and **in the background to
stored objects**:

- A type has a `rules_version`, which goes up with every change to its
  properties except display names and descriptions.
- Every object records the rules version it was last checked against. Its
  `validation` is `{"state": "valid"}` or `{"state": "invalid", "errors":
  [...]}` (each error with a `path` and a `message`) when that is the
  type's current version, and `{"state": "pending"}` until the background
  job has checked it.
- A write checks the current rules and marks the object valid. The job
  checks pending objects in batches, against the newest rules version (a
  change made while it runs supersedes the older one), and reports its
  progress as `type.validation` events.
- Invalid objects are kept as they are. Their next write must satisfy the
  rules.
- A type's `validation` summarizes its objects against the current rules:
  `pending` while some are unchecked, then `violated` if some failed, or
  `enforced` if all passed.

```json
{ "rules_version": 3, "state": "violated", "objects": 1200, "validated": 1200, "invalid": 4 }
```

Query `{"op": "validation", "state": "invalid"}` to find the objects to fix.
A `unique` value is held only by valid objects: an object that shares one
with another object becomes invalid, and is checked again once the other
object gives the value up. An object is marked valid only if it passes as
stored; anything the job cannot prove (a validator that ran out of time, a
user or file it refers to that is gone) makes it invalid.

A type that still has live objects or link types cannot be deleted.

## Property ids

Every property and struct field has a server-assigned `id` (a cuid2) that
it keeps across renames, and stored values are keyed by it, not by name.

* **Renaming.** Send the property with its `id` and a new `api_name`. A
  property sent without an `id` matches the existing one with the same
  `api_name`; anything unmatched is new and gets a fresh id.
* **Types are fixed.** The type of an existing property never changes
  (`422`). To change it, remove the property and add a new one.
* **Removing is instant.** A property left out of a `PUT` disappears at once
  from reads, queries, filters, MCP tools, and events, without the request
  reading or rewriting any object. A background maintenance job strips its
  stored values and unique entries later; that purge changes nothing the API
  shows.
* **Removed means gone.** A property added later under a removed name gets a
  new id, so the old values never come back, even before they are purged.

```json
{
  "properties": [
    { "id": "p7r2o4p6e8r1t3y5i7d9x2c4", "api_name": "full_name", "type": { "kind": "string" }, "required": true }
  ]
}
```

Here `name` is renamed to `full_name`, and every other property is removed.

## Link types and links

A link type connects a source type (`from_type`) to a target type
(`to_type`), which may be the same type:

```json
{
  "api_name": "works_on",
  "from_type": "employee",
  "to_type": "project",
  "cardinality": "many_to_many",
  "forward_name": "projects",
  "reverse_name": "members"
}
```

- **Cardinality** is `one_to_one`, `one_to_many`, `many_to_one`, or
  `many_to_many`. It is enforced by partial unique indexes on a copy of the
  cardinality stored in each link, so the database refuses a link that breaks
  it (`409`). Changing a link type's cardinality fails while visible links
  break the new one.
- **End names.** `forward_name` names the link from the source,
  `reverse_name` from the target. End names are unique per object type, and
  a link from a type to itself needs two different names.
- Links join objects of the declared types within one organization, enforced
  by composite foreign keys.
- A link is visible only while its link type and both its objects exist.

## Deletion

Deleting an object, a link type, or an object type is instant: it is gone
from every read, query, filter, MCP tool, and event at once, and a background
job removes the rows later without changing anything the API shows.

- The links of a deleted object or link type disappear with it, each with a
  `link.deleted` event, and no longer count for cardinality: a new link
  first removes the hidden links in its way.
- A deleted object's unique values are free at once, and so are a deleted
  type's or link type's names.
- A deleted object type is kept as a tombstone, so subscribers allowed to
  see it receive its `type.deleted` event, until its events expire.

## Queries

`POST /v1/ontology/objects/{type}/query` takes a filter tree, an ordering,
and a page size, and returns a page with a cursor for the next one:

```json
{
  "filter": {
    "op": "and",
    "filters": [
      { "op": "gte", "property": "age", "value": 30 },
      { "op": "contains", "property": "name", "value": "ad" },
      { "op": "linked", "link": "projects", "object": "o9k3m7p1s5v2x6z0b4d8f2h6" }
    ]
  },
  "order_by": { "property": "age", "direction": "desc" },
  "limit": 50
}
```

| `op` | Fields | |
|---|---|---|
| `and`, `or` | `filters` | |
| `not` | `filter` | |
| `eq`, `ne`, `gt`, `gte`, `lt`, `lte` | `property`, `value` | |
| `in` | `property`, `values` | up to 500 values |
| `contains` | `property`, `value` | strings: case-insensitive substring; arrays: has this element |
| `starts_with` | `property`, `value` | strings |
| `is_null` | `property` | the property is absent |
| `linked` | `link`, `object` | linked to that object through this type's end named `link` |
| `validation` | `state` | `valid`, `invalid`, or `pending` against the type's current rules |

Operands are checked against the property's type and bound as SQL parameters;
property names are checked against the type too. Filters have at most 100
conditions and nest at most 10 deep.

`order_by` is a scalar property, or `$id`, `$created_at`, `$updated_at`, with
`direction` `asc` (default) or `desc`; missing values sort last. Pagination
uses keyset cursors: pass `next_cursor` back as `cursor`. `limit` is 1-500,
default 50.

## Access

Ontology access combines organization-wide permissions with per-type rules:

- `view_objects` reaches the objects of every **unrestricted** type;
  `edit_objects` lets you change them. Editing needs both, because editing
  includes viewing.
- An owner can **restrict** a type (`PUT .../object-types/{type}/access`).
  Then only owners and teams granted `view_objects` or `edit_objects` *on that
  type* reach its objects. To everyone else the type does not exist: `404`.
- Links to types you cannot view are hidden, and you cannot navigate them.
- Schema changes need `manage_ontology` **and** view access to the type,
  because whether a change is accepted says something about the stored values.
- `manage_ontology` alone cannot decide who reads data: access settings are
  owner-only.
- OAuth grants (MCP clients) never change the schema.

## Live updates

Every change to the ontology is also an event in the organization's outbox,
streamed as server-sent events. See [Live events](/docs/concepts/live-events/).

These rules are modeled in `proofs/HappyEnterprise/Ontology.lean` as a state
machine whose invariant is that every live object marked valid at its type's
current rules version satisfies it (so an enforced type's objects all do),
every link joins objects of its declared types and respects its cardinality,
and unique values stay unique among valid objects. It also proves that links
of deleted objects and link types are never visible, and that the background
job changes nothing the API shows except validation marks.
