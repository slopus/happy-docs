---
layout: ../../../layouts/Docs.astro
title: Ontology schema
lead: Object types and their versions, access to restricted types, and link types.
---

The concepts, property types, and format rules are described in
[The ontology](/docs/concepts/ontology/). Object types and link types are
addressed by their `api_name`.

## The ontology

### GET /v1/ontology

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_objects or manage_ontology</span></p>

The object and link types you can see: all of them with `manage_ontology`,
otherwise the types you may view and the link types between them.

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

## Access to restricted types

### GET /v1/ontology/object-types/{type}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

```json
{
  "restricted": true,
  "assignee_property": "assignee",
  "grants": [
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "edit_objects", "scope": "all" },
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "view_objects", "scope": "all" },
    { "team_id": "t3e5c7h9n1i2c3i4a5n6s7x8", "permission": "view_objects", "scope": "assigned" }
  ]
}
```

### PUT /v1/ontology/object-types/{type}/access

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Sets whether the type is restricted and replaces its grants. When restricted,
only owners and the granted teams reach its objects, and to everyone else the
type does not exist. Grants have no effect while the type is unrestricted.

```json
{
  "restricted": true,
  "assignee_property": "assignee",
  "grants": [
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "view_objects" },
    { "team_id": "m2n4b6v8c0x1z3l5k7j9h0g2", "permission": "edit_objects" },
    { "team_id": "t3e5c7h9n1i2c3i4a5n6s7x8", "permission": "view_objects", "scope": "assigned" }
  ]
}
```

A grant's `permission` is `view_objects` or `edit_objects`. Its `scope` is
`all` (the default) or, for `view_objects` on a type with an
`assignee_property`, `assigned`: only the objects whose assignee property
holds the member's own id. `assignee_property` is optional: the `api_name`
of a top-level `user_ref` property, or `null`. See
[Assigned objects](/docs/concepts/ontology/#assigned-objects). A member still
needs the organization-wide permission too: a grant narrows who may use
`view_objects` on the type, it does not hand it out. Returns the access
settings and emits a `type.changed` event. `400` for an unknown team or
permission, an `assigned` grant without an `assignee_property` or on
`edit_objects`, an `assignee_property` that is not a top-level `user_ref`,
or two grants for the same team and permission.

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
