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
| `file_ref` | the id of a file of this organization that the writer can read, checked on write |
| `user_ref` | the id of a user of this organization, checked on write |
| `team_ref` | the id of a team of this organization, checked on write |
| `array` | `{ "kind": "array", "items": { "type": ..., "rules": [...] } }`: elements of one type, each with its own rules |
| `struct` | `{ "kind": "struct", "fields": [ properties... ] }`: a nested object |

Arrays and structs nest at most 4 deep.

A reference to a user, team, or file that does not exist is a `422`: "the
properties refer to users, teams or files that do not exist". A file the
writer cannot read counts as one that does not exist, so a write can only
attach files its writer could already read.

### Format rules

| `rule` | Applies to | Meaning |
|---|---|---|
| `min` `{value}`, `max` `{value}` | numbers | inclusive bounds |
| `length` `{min?, max?}` | strings, arrays | characters of a string, elements of an array |
| `regex` `{pattern}` | strings | Rust `regex` syntax, at most 1000 characters and size-limited when compiled; the whole string must match, so anchor it yourself |
| `enum` `{values}` | strings, integers | one of up to 500 values |
| `email` | strings | an email address (built-in) |
| `url` | strings | an absolute `http` or `https` URL (built-in) |
| `uuid`, `cuid` | strings | a UUID, a cuid2 (built-in) |
| `format` `{name, version}` | strings, including nested values | one of the organization's own [formats](/docs/concepts/validators/#formats) |
| `unique` | top-level scalar properties other than booleans | no two objects of the type share the value |
| `sequence` | top-level integers, from the start | numbered by the server: 1, 2, 3, ... (see [Sequences](#sequences)) |
| `validator` `{name, version}` | any type, including nested values | a [custom validator](/docs/concepts/validators/) |

A property may have up to 20 rules. Rules that do not fit their type (`email`
on an integer, an invalid regex) are refused with the definition, every
problem listed in a `422 validation_failed`.

### Sequences

A top-level `integer` property with `{"rule": "sequence"}` is numbered by the
server: invoice numbers, deal numbers, stock numbers.

```json
{ "api_name": "number", "type": { "kind": "integer" }, "rules": [{ "rule": "sequence" }] }
```

- Every create, through REST, MCP, or an action, gets the next number, 1, 2,
  3, ..., counted per organization, type, and property.
- Numbers are given out **without gaps, in commit order**. The counter stays
  locked from the create until its transaction commits, so creates of one
  type wait for each other for that moment, and a create that rolls back
  gives its number back. A deleted object's number is not given out again.
- Writes may not set or change the number (`422`). Within an action, the
  number is readable once the object is created, for example in an email as
  `{{created.invoice.number}}`.
- The rule implies `unique`.
- It applies only to a property that has it from the start. Adding it to an
  existing property is refused; add a new property instead.

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
  progress as `type.validation` events, at most once a second (less often on
  large types) while the job runs, and once when it is done with the type.
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
- A restricted type can also limit a team to **the objects shared with or
  assigned to each member**; see
  [Shared and assigned objects](#shared-and-assigned-objects) below.
- Links to types you cannot view are hidden, and you cannot navigate them.
- Schema changes need `manage_ontology` **and** a view of the whole type,
  because whether a change is accepted says something about the stored values.
  A view of only the objects shared with you is not enough: `403`.
- `manage_ontology` alone cannot decide who reads data: access settings are
  owner-only.
- OAuth grants (MCP clients) never change the schema.
- A team granted a [business action](/docs/concepts/actions/) may make that
  action's edits without `edit_objects`, but still needs view access to
  every type the action touches.

### Shared and assigned objects

A restricted type may name **access properties**: top-level properties of
type `user_ref` or `team_ref`, or arrays of either, such as an incident's
`assignee`, a document's `owner`, or its `viewers` and `teams` lists. A
`view_objects` grant on the type is then either for all of its objects
(`scope: "all"`, the default) or only for the objects that name the member
(`scope: "assigned"`): those where one of the access properties holds the
member's own user id, or the id of a team they are on, as the value or as an
element of the list.

```json
PUT /v1/ontology/object-types/incident/access
{ "restricted": true,
  "access_properties": ["assignee"],
  "grants": [
    { "team_id": "<dispatch>", "permission": "view_objects" },
    { "team_id": "<dispatch>", "permission": "edit_objects" },
    { "team_id": "<supervisors>", "permission": "view_objects" },
    { "team_id": "<technicians>", "permission": "view_objects", "scope": "assigned" } ] }
```

Here every technician sees only the incidents assigned to them; dispatch and
supervisors see all of them. Owners always see every object.

The same mechanism shares objects. A document type with
`"access_properties": ["owner", "editors", "viewers", "teams"]` and an
`assigned` view grant to `everyone` lets each member see the documents they
own, the ones listing them as an editor or viewer, and the ones shared with
a team they are on. Sharing is a write to one of those properties, so who
may share is decided like any other write, usually by a
[business action](/docs/concepts/actions/). See
[Example: document management](/docs/examples/documents/).

Postgres enforces this itself, with a second row level security policy on
objects that can only narrow what the organization policy shows, for reads
and for writes. So it holds everywhere the objects are reached:

- **Reads.** Gets, queries, `linked` filters, link navigation, MCP tools, and
  [actions](/docs/concepts/actions/) see only the objects in reach. Any other
  object answers `404`, as if it did not exist; passed to an action, it is
  refused as an unknown object (`422`, at `params.<name>`).
- **Files.** Files that a visible object refers to through a `file_ref` can
  be read with it, and stop being readable when the object is unshared. See
  [Files](/docs/concepts/files-and-email/#who-may-read-a-file).
- **Writes.** An edit grant reaches what its holder can see. Sharing an
  object further is allowed wherever you may edit it. A write that would
  leave an object out of its writer's sight is `403 forbidden` ("you may only
  write objects that stay shared with you"): unsharing it from yourself,
  handing your incident to someone else, or creating one only for someone
  else. Hidden objects are never changed.
- **Teams.** Leaving a team ends access to what was shared with that team at
  once; joining one starts it.
- **Links.** Deleting an object linked to objects you cannot see is `409`;
  removing a link to one is `404`.
- **Events.** For a type you see only in part, an event reaches you only if
  you see every object it names when the event is read, and the type's
  `type.validation` progress events never do. An object shared with you
  starts sending you its events.
- **Removing a property.** If a schema change removes an access property, it
  is also removed from the type's `access_properties`; while none are left,
  `assigned` grants reach nothing.

Two things can still hint at hidden objects: a `409` for a `unique` value or
a link's cardinality can reveal that an object you cannot see holds it, and
a type's `validation` counts cover only the objects you see.

## Live updates

Every change to the ontology is also an event in the organization's outbox,
streamed as server-sent events. See [Live events](/docs/concepts/live-events/).

Taken together: every live object marked valid at its type's current rules
version satisfies those rules (so an enforced type's objects all do), every
link joins objects of its declared types and respects its cardinality, and
unique values stay unique among valid objects. Links of deleted objects and
link types are never visible, and the background job changes nothing the API
shows except validation marks.
