---
layout: ../../../layouts/Docs.astro
title: Teams
lead: The system teams owners and everyone, custom teams, their members, and the permissions they grant.
---

See [Users, teams, permissions](/docs/concepts/organisations/) for the rules.

A team in responses:

```json
{
  "id": "m2n4b6v8c0x1z3l5k7j9h0g2",
  "kind": "custom",
  "name": "Engineering",
  "permissions": ["edit_objects", "view_objects"],
  "member_count": 12
}
```

`kind` is `owners`, `everyone`, or `custom`. The `owners` team lists every
permission, because owners hold all of them implicitly.

### GET /v1/teams

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>none</span></p>

Every team: `owners`, then `everyone`, then custom teams by name.

### POST /v1/teams

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

```json
{ "name": "Engineering" }
```

`201`:

```json
{ "id": "m2n4b6v8c0x1z3l5k7j9h0g2", "kind": "custom", "name": "Engineering" }
```

`name` is 1-100 characters and unique in the organisation (`409` otherwise).
A new team has no members and no permissions.

### DELETE /v1/teams/{team}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Deletes a custom team. `204`. `409` for `owners` and `everyone`.

### GET /v1/teams/{team}/members

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_members</span></p>

The team's members as [user objects](/docs/api/me/#the-user-object).

### PUT /v1/teams/{team}/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Adds an active user to the team. Adding to `owners` makes the user an owner.
`204`. `409` for `everyone`, which every user always belongs to; `404` for an
unknown or deactivated user.

### DELETE /v1/teams/{team}/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Removes a user from the team. `204`. `409` for `everyone`, and for the last
active owner leaving `owners`.

### PUT /v1/teams/{team}/permissions

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Replaces the team's permissions.

```json
{ "permissions": ["view_members", "view_objects", "edit_objects"] }
```

Returns every team, as `GET /v1/teams` does. `400` for an unknown permission;
`409` for `owners`, which always holds every permission. Granting a permission
to `everyone` grants it to every user.

Valid permissions: `invite_members`, `view_members`, `change_security_posture`,
`manage_organization`, `manage_ontology`, `view_objects`, `edit_objects`.
