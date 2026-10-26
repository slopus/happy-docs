---
layout: ../../../layouts/Docs.astro
title: Teams
lead: The system teams owners and everyone, custom teams, their members and membership history, and the permissions they grant.
---

See [Users, teams, permissions](/docs/concepts/organizations/) for the rules.

A team in responses:

```json
{
  "id": "m2n4b6v8c0x1z3l5k7j9h0g2",
  "kind": "custom",
  "name": "Engineering",
  "type": "team",
  "permissions": ["edit_objects", "view_objects"],
  "member_count": 12
}
```

`kind` is `owners`, `everyone`, or `custom`. `type` is the api name of a custom
team's [team type](/docs/concepts/organizations/#teams), `null` for the
system teams. The team's id is also the id of its object, so
`GET /v1/ontology/objects/{type}/{id}` reads the team's other properties. The
`owners` team lists every permission, because owners hold all of them
implicitly. `member_count` counts direct, current members.

### GET /v1/teams

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>none</span></p>

The teams you can see: `owners`, then `everyone`, then custom teams by name.
A custom team is listed if you may view its object; owners see every team.

### POST /v1/teams

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Creates a team of the organization's default team type, the oldest team type.
If the organization has none, this creates one first: `team`, restricted,
viewable by `everyone`, editable by owners only.

```json
{ "name": "Engineering" }
```

`201`:

```json
{ "id": "m2n4b6v8c0x1z3l5k7j9h0g2", "kind": "custom", "name": "Engineering", "type": "team" }
```

`name` is 1-100 characters and unique in the organization, across team types
(`409` otherwise). A new team has no members and no permissions. To create a
team of another type, or with more properties, create an object of the team
type (`POST /v1/ontology/objects/{type}` with `name` among its properties);
that needs edit access to the type, not ownership.

### DELETE /v1/teams/{team}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Deletes a custom team, by deleting its object. Its memberships, permissions
and grants go with it. `204`. `409` for `owners` and `everyone`. Deleting the
object through the ontology API does the same.

### GET /v1/teams/{team}/members

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_members</span></p>

Needs a view of the team, as for listing it. The team's current direct members as [user objects](/docs/api/me/#the-user-object),
each with `membership_expires_at`: when the membership ends, or `null`.
Members whose membership has ended are not listed, and the team's
`member_count` does not count them. Members of subteams are not listed here;
`GET /v1/me` shows a user's effective teams.

### GET /v1/teams/{team}/history

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_members</span></p>

Every change to the team's memberships, newest first. Needs a view of the
team, as for listing it.

| Query | |
|---|---|
| `before` | only changes with a smaller `seq`: pass the last `seq` of the previous page |
| `limit` | 1-200, default 50 |

```json
{
  "changes": [
    {
      "seq": 42,
      "user_id": "u5s4e3r2i1d0a9b8c7d6e5f4",
      "change": "added",
      "expires_at": "2026-11-08T10:00:00Z",
      "changed_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
      "changed_at": "2026-10-26T09:12:00Z"
    }
  ]
}
```

`change` is `added`, `renewed` (added again, with a new `expires_at` or for
good), or `removed`. `changed_by` is the user whose request made the change,
including through an [action](/docs/concepts/actions/#edits), or `null` if
that user is gone. A membership
that runs out at its `expires_at` is not a change and is not listed.

### PUT /v1/teams/{team}/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit access to the team</span></p>

Adds an active user to the team. For a custom team this needs edit access to
the team's object: `edit_objects` on its type and the object in your sight
(owners always have it). For `owners` it needs an owner, and adding to
`owners` makes the user an owner. `204`. `409` for `everyone`, which every
user always belongs to; `404` for an unknown or deactivated user, or a team
you cannot see. The change is recorded in the team's history and sent as a
`team.member_added` [live event](/docs/api/events/).

The body is optional. With `expires_at`, the membership ends at that time
([Memberships that end](/docs/concepts/organizations/#memberships-that-end)):

```json
{ "expires_at": "2026-11-08T10:00:00Z" }
```

`expires_at` must be in the future and is for custom teams only (`422`
otherwise). Sending `PUT` again renews the membership: until the new
`expires_at`, or for good without one.

### DELETE /v1/teams/{team}/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>edit access to the team</span></p>

Removes a user from the team, with the same access as adding. `204`. `409`
for `everyone`, and for the last active owner leaving `owners`. Recorded in
the history and sent as `team.member_removed`.

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
