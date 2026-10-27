---
layout: ../../../layouts/Docs.astro
title: Ontology schema
lead: Object types and their versions, team types, access to restricted types and properties, and link types and team hierarchies.
---

The concepts, property types, and format rules are described in
[The ontology](/docs/concepts/ontology/). Object types and link types are
addressed by their `api_name`.

## The ontology

### GET /v1/ontology

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects or manage_ontology</span></p>

The object and link types you can see: all of them with `manage_ontology`,
otherwise the types you may view and the link types between them. Each type
shows only the properties you may see; those you see but may not write are
listed in `read_only_properties`, which is left out when empty. See
[Restricted properties](/docs/concepts/ontology/#restricted-properties).

```json
{
  "object_types": [
    {
      "id": "t2y4p6e8i0d1q3w5r7u9a1s3",
      "api_name": "employee",
      "display_name": "Employee",
      "description": "",
      "properties": [
        { "id": "p7r2o4p6e8r1t3y5i7d9x2c4", "api_name": "name", "type": { "kind": "string" },
          "required": true, "rules": [{ "rule": "length", "min": 1, "max": 100 }] }
      ],
      "restricted": false,
      "kind": "object",
      "version": 2,
      "rules_version": 2,
      "validation": { "rules_version": 2, "state": "enforced", "objects": 120, "validated": 120, "invalid": 0 },
      "created_at": "2026-10-20T09:00:00Z",
      "updated_at": "2026-10-24T10:00:00Z"
    }
  ],
  "link_types": [
    {
      "id": "r5t7y9u1i3o5p7a9s1d3f5g7",
      "api_name": "works_on",
      "display_name": "Works on",
      "from_type": "employee",
      "to_type": "project",
      "cardinality": "many_to_many",
      "forward_name": "projects",
      "reverse_name": "members",
      "created_at": "2026-10-20T09:05:00Z",
      "updated_at": "2026-10-20T09:05:00Z"
    }
  ]
}
```

A type's `validation` summary is shown only to callers who see every one of
its properties; to others, an object type shows no summary, and they get no
`type.validation` events.

## Object types

### POST /v1/ontology/object-types

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology</span></p>

```json
{
  "api_name": "employee",
  "display_name": "Employee",
  "description": "People on the payroll.",
  "properties": [
    { "api_name": "name", "type": { "kind": "string" }, "required": true,
      "rules": [{ "rule": "length", "min": 1, "max": 100 }] },
    { "api_name": "email", "type": { "kind": "string" },
      "rules": [{ "rule": "email" }, { "rule": "unique" }] },
    { "api_name": "started", "type": { "kind": "date" } },
    { "api_name": "office", "type": { "kind": "geo_point" } },
    { "api_name": "skills", "type": { "kind": "array",
      "items": { "type": { "kind": "string" }, "rules": [{ "rule": "length", "max": 40 }] } } },
    { "api_name": "address", "type": { "kind": "struct", "fields": [
      { "api_name": "city", "type": { "kind": "string" }, "required": true },
      { "api_name": "country", "type": { "kind": "string" }, "rules": [{ "rule": "enum", "values": ["GB", "US", "DE"] }] }
    ] } }
  ]
}
```

`201` with the object type at `version` 1. `api_name` matches
`[a-z][a-z0-9_]{0,62}`; `display_name` is 1-200 characters; `description` up
to 2000.

`kind` is `object` (the default); `team`, for a
[team type](/docs/concepts/ontology/#team-types) whose objects are teams;
`timeseries`, for a [timeseries type](#timeseries-types) that holds series
of points; `chat`, for a [chat type](#chat-types) that holds channels of
messages; or `filesystem`, for a [filesystem type](#filesystem-types) that
holds a tree of folders and files. It is set here and never changes. A team type needs a required
string property `name` (`422` without one), and every later `PUT` must keep
it.

A property of kind `integer` or `double` may have a `unit`, 1-32 characters
(`"°C"`, `"kWh"`): a label for readers, not a rule.

- `422 validation_failed` lists every problem with the definition (rules that
  do not fit their type, invalid patterns, duplicate names, too deep nesting,
  unknown validator versions).
- `409` if a live type with this `api_name` exists.

### GET /v1/ontology/object-types/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects on the type, or manage_ontology</span></p>

The object type. `404` if unknown or restricted from you.

### PUT /v1/ontology/object-types/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology and a view of the whole type</span></p>

Replaces the definition and bumps `version`. `properties` is required;
`display_name` and `description` keep their values when omitted.
`expected_version` makes the change conditional.

Properties keep their [ids](/docs/concepts/ontology/#property-ids): a
property that names its `id` keeps it (and may be renamed), one without an
`id` matches the existing property with its `api_name`, and the rest are new.
Properties left out are removed at once; their values are purged in the
background.

```json
{
  "properties": [
    { "id": "p7r2o4p6e8r1t3y5i7d9x2c4", "api_name": "full_name", "type": { "kind": "string" }, "required": true },
    { "api_name": "email", "type": { "kind": "string" }, "required": true,
      "rules": [{ "rule": "email" }, { "rule": "unique" }] }
  ],
  "expected_version": 1
}
```

Returns the type at its new version. The change never reads the stored
objects: if it changes the rules (anything but display names and
descriptions), `rules_version` goes up, every object is `pending`, and the
background job checks them against the new rules, reporting progress in
`validation` and as `type.validation` events. Writes check the new rules at
once. Errors:

- `409 conflict` if the type is no longer at `expected_version`,
- `422` for an invalid definition: among others, an existing property whose
  type changed ("remove it and add a new property"), or an unknown or
  repeated property `id`.

### DELETE /v1/ontology/object-types/{type}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology and a view of the whole type</span></p>

`204`, at once: the type disappears and its `api_name` is free. `409` while
the type has live objects or link types.

### GET /v1/ontology/object-types/{type}/versions

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology and a view of the whole type</span></p>

Every version of the definition, newest first.

```json
{
  "versions": [
    { "version": 2, "display_name": "Employee", "description": "", "properties": [ ... ],
      "created_by": "h3jd8s0q2l5x7c1v9b4n6m8k", "created_at": "2026-10-24T10:00:00Z" },
    { "version": 1, "display_name": "Employee", "description": "", "properties": [ ... ],
      "created_by": "h3jd8s0q2l5x7c1v9b4n6m8k", "created_at": "2026-10-20T09:00:00Z" }
  ]
}
```

### Timeseries types

A type of kind `timeseries` also takes `timeseries` settings, on `POST` and
`PUT`:

```json
{
  "api_name": "telemetry",
  "display_name": "Telemetry",
  "kind": "timeseries",
  "properties": [
    { "api_name": "temperature", "type": { "kind": "double" }, "unit": "°C" },
    { "api_name": "running", "type": { "kind": "boolean" } }
  ],
  "timeseries": { "object_type": "machine", "tags": ["sensor"], "retention_days": 30, "live": true }
}
```

| Setting | |
|---|---|
| `object_type` | optional: the object type whose objects the series belong to (a type with objects, which you may manage); never changes |
| `tags` | up to 16 tag names, `api_name`s; a `PUT` may add tags but not remove any |
| `retention_days` | optional, 1-36,500: points older than this are hidden at once and deleted later |
| `live` | `true` to emit `series.points` events, default `false` |

The properties are the points' fields: 1-64 of kind `integer`, `double`,
`boolean`, or `string`, with built-in rules only (`422` otherwise). A `PUT`
without `timeseries` keeps the settings; with it, the settings are replaced
as a whole. `400` for `timeseries` settings on another kind of type.

Timeseries types show their settings, with `inherit_object_access` (set
with the [type's access](#put-v1-ontology-object-types-type-access)), in the
ontology, the type, and its versions (versions leave
`inherit_object_access` out). They have no objects or links: the object,
link type and action endpoints refuse them (`400`), and points have
[their own endpoints](/docs/api/timeseries/). An object type cannot be
deleted while a live timeseries type refers to it (`409`). See
[Timeseries](/docs/concepts/timeseries/).

### Chat types

A type of kind `chat` takes `chat` settings, on `POST` and `PUT`:

```json
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

| Setting | |
|---|---|
| `object_type` | optional: the object type whose objects channels may be about (a type with objects, which you may manage); never changes |
| `retention_days` | optional, 1-36,500: a thread is hidden once its first message is older, and deleted later |

The properties are optional message fields: up to 32 of kind `integer`,
`double`, `boolean`, or `string`, with built-in rules only (`422`
otherwise). A `PUT` without `chat` keeps the settings. `400` for `chat`
settings on another kind of type. Chat types show their settings as `chat`
in the ontology, the type, and its versions. They have no objects or links:
channels and messages have [their own endpoints](/docs/api/chat/). A chat
type cannot be deleted while it has channels, nor an object type while a
chat type refers to it (`409`). See [Chat](/docs/concepts/chat/).

### Filesystem types

A type of kind `filesystem` takes `filesystem` settings, on `POST` and
`PUT`:

```json
{
  "api_name": "drive",
  "display_name": "Drive",
  "kind": "filesystem",
  "properties": [
    { "api_name": "status", "type": { "kind": "string" },
      "rules": [{ "rule": "enum", "values": ["draft", "final"] }] }
  ],
  "filesystem": { "trash_days": 14 }
}
```

| Setting | |
|---|---|
| `trash_days` | optional, 1-3,650, default 30: how long deleted folders and files can be restored before they are purged |

Creating the type creates its root folder. The properties are optional
fields of every folder and file: up to 32 of kind `integer`, `double`,
`boolean`, or `string`, with built-in rules only (`422` otherwise). A `PUT`
without `filesystem` keeps the settings. `400` for `filesystem` settings on
another kind of type. Filesystem types show their settings as `filesystem`
in the ontology, the type, and its versions. They have no objects or links:
folders and files have [their own endpoints](/docs/api/filesystem/). A
filesystem type cannot be deleted while it has folders or files out of the
trash, or folders hidden from you (`409`); once it is deleted, its tree
goes too. See [Filesystems](/docs/concepts/filesystem/).

## Access to restricted types and properties

### GET /v1/ontology/object-types/{type}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

```json
{
  "restricted": true,
  "access_properties": ["assignee"],
  "grants": [
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "edit_objects", "scope": "all" },
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "view_objects", "scope": "all" },
    { "team_id": "t3e5c7h9n1i2c3i4a5n6s7x8", "permission": "view_objects", "scope": "assigned" }
  ],
  "properties": [
    { "property": "cost", "grants": [{ "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "edit_objects" }] }
  ]
}
```

### PUT /v1/ontology/object-types/{type}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Sets whether the type is restricted and replaces its grants, and, with
`properties`, its restricted properties. When restricted, only owners and the
granted teams reach its objects, and to everyone else the type does not
exist. Type grants have no effect while the type is unrestricted; property
restrictions apply either way.

```json
{
  "restricted": true,
  "access_properties": ["assignee"],
  "grants": [
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "view_objects" },
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "edit_objects" },
    { "team_id": "t3e5c7h9n1i2c3i4a5n6s7x8", "permission": "view_objects", "scope": "assigned" }
  ]
}
```

A grant's `permission` is `view_objects` or `edit_objects`. Its `scope` is
`all` (the default) or, for `view_objects` on a type with
`access_properties`, `assigned`: only the objects that name the member in one
of those properties, by their own id or the id of a team they are on, as the
value or as an element of a list. `access_properties` is optional (default
`[]`): the `api_name`s of top-level properties of type `user_ref`,
`team_ref`, or an array of either. See
[Shared and assigned objects](/docs/concepts/ontology/#shared-and-assigned-objects).

`properties` lists the restricted properties, each a top-level property by
`api_name` with its grants, `view_objects` (sees it) or `edit_objects` (sees
and writes it). The list replaces the previous one; `[]` lifts every property
restriction, and leaving `properties` out keeps them as they are. See
[Restricted properties](/docs/concepts/ontology/#restricted-properties).
A member still needs the organization-wide permission too: a grant narrows
who may use `view_objects` on the type, it does not hand it out. Returns the
access settings and emits a `type.changed` event.

`400` for an unknown team or permission, an `assigned` grant without
`access_properties` or on `edit_objects`, an access property that is not a
top-level `user_ref` or `team_ref` or an array of either, a property named
twice, or two grants for the same team and permission. For `properties`,
`400` for a name that is not a top-level property, a property named twice, a
grant other than `view_objects` or `edit_objects`, or a team type's `name`,
which is never restricted.

For a [timeseries type](#timeseries-types) with an `object_type`,
`inherit_object_access: true` lets whoever may view its object type read
its series, each only while its object is visible to them; writing still
needs the timeseries type's own grants. Left as it is when absent; `400` on
any other type. Timeseries, chat and filesystem types take no
`access_properties` or `properties` (`400`); restricted filesystem folders
are set per folder, with the [folder access](/docs/api/filesystem/#folder-access)
endpoints. Unknown fields are refused, including
`assignee_property`, which `access_properties` replaced.

## Link types

### POST /v1/ontology/link-types

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology and a view of both whole types</span></p>

```json
{
  "api_name": "works_on",
  "display_name": "Works on",
  "from_type": "employee",
  "to_type": "project",
  "cardinality": "many_to_many",
  "forward_name": "projects",
  "reverse_name": "members"
}
```

`201` with the link type. `api_name`, `forward_name`, and `reverse_name` match
`[a-z][a-z0-9_]{0,62}`; `display_name` defaults to `api_name`. `cardinality`
is `one_to_one`, `one_to_many`, `many_to_one`, or `many_to_many`.

`team_hierarchy`, optional, makes the link type a
[team hierarchy](/docs/concepts/ontology/#team-hierarchies) between two team
types, from subteam to parent: `nested` (structure only) or `inherited` (the
subteam's members count as the parent's for every grant). It is set here and
never changes, and the link type shows it. `400` for another value or a type
that is not a team type. A link of a hierarchy that would close a cycle is
`409`, and linking two teams needs edit access to both.

`409` if the `api_name` exists, or if either type already has a link end with
that name. A link from a type to itself needs two different names (`400`).

### PATCH /v1/ontology/link-types/{link}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology and a view of both whole types</span></p>

```json
{ "display_name": "Assigned to", "cardinality": "many_to_one" }
```

Both fields are optional. Returns the link type. `409` if visible links break
the new cardinality; links of deleted objects do not count.

### DELETE /v1/ontology/link-types/{link}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology and a view of both whole types</span></p>

Deletes the link type, at once: it and its links disappear from every read
(one `link.deleted` event per link) and its names are free. The rows are
removed in the background. `204`.
