---
layout: ../../../layouts/Docs.astro
title: Users, teams, permissions
lead: An organization has human and agent users, two system teams and any number of custom ones, and seven permissions that teams grant to their members.
---

## Users

A user is either a **human** or an **agent**.

| Kind | Signs in with | Notes |
|---|---|---|
| `human` | an emailed 6-digit code, an invite, an external JWT from the organization's identity provider | has an email address; subject to the organization's two-factor requirement |
| `agent` | API tokens `heat_<org>_<token id>_<secret>`, or an external JWT | no email and no second factor; created by a member with `invite_members` |

Every user has a profile: `display_name` (1-200 characters), `about` (up to
2000), an optional `birthday`, an avatar, and a status (an emoji of up to 32
characters, text of up to 200, and an optional expiry after which the status
is hidden).

**Deactivating** a user (owners only) ends their sessions and API tokens
immediately and keeps them from logging in again. Their rows stay, so
references to them in the ontology still resolve. The last active owner
cannot be deactivated.

## Teams

Two **system teams** exist in every organization, created with it and never
deleted or renamed:

- **`owners`.** Its members are the organization's owners. Owners hold every
  permission implicitly, and some actions are owner-only: deactivating
  members, creating and deleting teams and changing their members and
  permissions, more tokens for an existing agent, and the access settings of
  restricted object types.
- **`everyone`.** Every user is a member and nobody can leave. A permission
  granted to `everyone` reaches every user.

Owners create **custom teams** (names of 1-100 characters, unique per
organization), add and remove members, and set each team's permissions. An
organization that has an active owner always keeps one: the last active owner
cannot leave `owners` or be deactivated.

### Memberships that end

A membership of a custom team may end at a set time, `expires_at`: a guest
for the length of a stay, a contractor for a project. From then on it counts
for nothing. No team permission, object type grant, action grant, or object
shared with the team reaches the member through it, and live streams see the
change too. Nothing has to run for this: every check reads only current
memberships, so the first request after `expires_at` already sees it.

Adding the member again renews the membership, until a new time or for good.
Memberships of `owners` and `everyone` never end, so owners stay owners. An
ended membership does not deactivate the user: they remain a member of the
organization, in `everyone`.

These rules are enforced twice. The handlers check them, and database
triggers enforce the same invariants independently of the application, so a
bug in a handler cannot break them.

## Permissions

Permissions are granted to teams. A user holds a permission if one of their
teams grants it, or if they are an owner.

| Permission | Allows | OAuth scope |
|---|---|---|
| `invite_members` | inviting people, creating agents | `mcp:invite` |
| `view_members` | the member directory, team member lists, other users' avatars | `mcp:read` |
| `change_security_posture` | the 2FA requirement and the allowed (verified) domains | none |
| `manage_organization` | the organization's name and photo | none |
| `manage_ontology` | object types, link types, custom validators and formats, action types | none |
| `view_objects` | reading ontology objects and links, and the event stream | `ontology:read` |
| `edit_objects` | creating, changing, deleting objects and links | `ontology:write` |

A new organization's `everyone` team holds `view_members` and
`view_objects`.

Besides these permissions, owners grant teams the right to apply each
[business action](/docs/concepts/actions/). That grant stands in for
`edit_objects` for the action's edits, so a team can, say, open work orders
without being able to edit incidents freely.

Everyone may always read their own profile (`GET /v1/me`,
`GET /v1/members/{own id}`) and the list of teams.

### How a request's permissions are decided

Every check goes through the request transaction's `permitted`, `require`, or
`require_owner`, never through ad hoc team lookups. `permitted(p)` is true
when:

1. the user holds `p` through a team (or is an owner), **and**
2. the credential's OAuth scopes allow `p`. First-party credentials (REST
   sessions, external JWTs, API tokens) carry no scopes and are not limited.
   OAuth grants are limited to the scope listed above, so a permission
   without a scope can never be used through OAuth.

`require_owner` additionally needs a first-party credential: no OAuth scope
reaches owner-only actions. So no credential is ever permitted more than its
user holds, and OAuth grants never administer the organization.

Permissions on ontology objects are further narrowed per object type when an
owner restricts a type, and can be narrowed to the objects shared with each
member or their teams. See [The ontology](/docs/concepts/ontology/#access).

## Joining an organization

Someone becomes a user in one of four ways:

1. **Bootstrap owner.** When the operator creates an organization through the
   management API, they name an `owner_email`. While the organization has no
   active owner, that address may log in with an email code and becomes the
   first owner. The system teams are created at that moment.
2. **Verified domain.** Any address whose domain is *exactly* one of the
   organization's verified domains may log in with an email code, and joins
   `everyone`. Subdomains do not count.
3. **Invite.** A member with `invite_members` invites an address. The invite
   is single use, bound to that address and organization, and expires after
   seven days. Accepting it logs in as the invited user.
4. **Agent.** A member with `invite_members` creates an agent, which gets its
   first API token.

Everyone else is turned away, with the same response a failed login gets.
[Authentication](/docs/concepts/authentication/) covers each path in detail.
