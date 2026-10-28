---
layout: ../../../layouts/Docs.astro
title: Users, teams, permissions
lead: An organization has human and agent users, two system teams and any number of custom ones, which can sit under each other, and eight permissions that teams grant to their members.
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
  members, `POST /v1/teams` and `DELETE /v1/teams/{team}`, team permissions,
  more tokens for an existing agent, and the access settings of object
  types.
- **`everyone`.** Every user is a member and nobody can leave. A permission
  granted to `everyone` reaches every user.

Every other team is a **custom team**, and custom teams live in the
[ontology](/docs/concepts/ontology/): each one is an object of a **team
type**, an object type of kind `team`. A team type has a required string
property `name` (1-100 characters, unique in the organization), which names
the team, and otherwise any properties, rules, validators and actions you
give it: a lead, an on-call phone number, a cost center. Creating the object
creates the team, renaming the object renames the team, and deleting the
object deletes the team with its memberships, permissions and grants. The
system teams stay outside the ontology: they are not objects, and they are in
no hierarchy.

So who sees and changes a team is decided by its type's access, like any
other object:

- Seeing a team (in the team list, its members, its history) needs view
  access to its object.
- Changing its memberships needs edit access to its object.
- Owners reach every team. Only owners change `owners`, and nobody leaves
  `everyone`.
- Owners set each team's permissions.

`POST /v1/teams` creates a team of the organization's default team type, its
oldest. If there is none yet, the first call creates one, `team`: restricted,
viewable by `everyone`, editable by owners only. Teams of other types are
created as their objects. Teams from before team types existed are moved into
the default team type, keeping their ids, by the maintenance job; until then
only owners change them.

An organization that has an active owner always keeps one: the last active
owner cannot leave `owners` or be deactivated.

### Subteams

A team can sit under another one. A link type between team types may be a
**team hierarchy**, set when the link type is created, and each link of it
puts a subteam (the link's source) under its parent (the target). There are
two kinds:

- **`nested`** links are structure only: an org chart, a reporting line.
- **`inherited`** links make the subteam's members count as members of the
  parent and of every team above it, for everything a team grants: team
  permissions, object type grants, action grants, property grants, and
  objects shared with the team.

The kind belongs to the link type, so every link of it behaves the same, and
one team type can carry both: `subteam_of` passing members up, `reports_to`
not. The hierarchy, both kinds together, never has a cycle (`409`), and
linking a team needs edit access to both teams, so nobody can put a team
under one they could not change. Removing a link, the team in the middle, or
the link type ends what came through it at once.

A user's **effective teams** are the teams they are a member of, plus every
team above those along inherited links. `GET /v1/me` lists them, each marked
`direct` or not. Grants and [action criteria](/docs/concepts/actions/#criteria)
both use the effective teams.

### Membership history

Every change to a membership is recorded: added, renewed, or removed, when,
and by whom, whatever made it (the API, the web app, an action).
`GET /v1/teams/{team}/history` lists the changes, newest first. Changes to a
team's memberships also send `team.member_added` and `team.member_removed`
[live events](/docs/concepts/live-events/) to subscribers who may see the
team's type. A membership that runs out sends nothing.

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
effective teams grants it (a team they are on, or one above it along
inherited links), or if they are an owner.

| Permission | Allows | OAuth scope |
|---|---|---|
| `invite_members` | inviting people, creating agents | `mcp:invite` |
| `view_members` | the member directory, team member lists, other users' avatars | `mcp:read` |
| `change_security_posture` | the 2FA requirement and the allowed (verified) domains | none |
| `manage_organization` | the organization's name and photo | none |
| `manage_ontology` | object types, link types, custom validators and formats, action types | none |
| `view_objects` | reading ontology objects and links, chat channels, folders and files, and the event stream | `ontology:read`; `chat:read` for chat; `files:read` for filesystems |
| `edit_objects` | creating, changing, deleting objects and links; writing in chat; writing folders and files | `ontology:write`; `chat:write` for chat; `files:write` for filesystems |
| `manage_connectors` | registering [connectors](/docs/concepts/connectors/) to outside MCP servers, reviewing their tools, granting them to teams, reading their call logs | none |

A new organization's `everyone` team holds `view_members` and
`view_objects`.

Besides these permissions, owners grant teams the right to apply each
[business action](/docs/concepts/actions/). That grant stands in for
`edit_objects` for the action's edits, so a team can, say, open work orders
without being able to edit incidents freely.

Everyone may always read their own profile (`GET /v1/me`,
`GET /v1/members/{own id}`) and the list of the teams they can see.

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
owner restricts a type, can be narrowed to the objects shared with each
member or their teams, and per property. See
[The ontology](/docs/concepts/ontology/#access).

### A formally verified model

The permission rules are a formally verified model: machine-checked proofs
show that the rules, as modelled, hold. For example:

- no credential is permitted more than its user holds; OAuth grants never
  act as owners or change the security posture, and MCP tokens never reach
  owner-only or manage-level rights;
- a membership that has ended grants nothing, until it is added anew;
- a restricted property is shown only to owners and the teams granted it,
  and hidden values change nothing a caller reads, filters, sorts, or
  receives as events;
- a change to a property you cannot see is unobservable to you: it changes
  no version, etag, update time or author, or validation state you are
  shown, and its event does not reach you;
- a hidden folder hides everything below it, whatever the query;
- a chat channel is seen only by those it is public to or who are its
  members, and only while its object is visible to them;
- search returns only what a read would return, and hidden text never
  matches, scores, or shows in a snippet;
- a connector tool is listed exactly when a call of it would be accepted.

The code is tested against that model; the code itself is not formally
verified. See also [Organizations and isolation](/docs/concepts/isolation/#a-formally-verified-model).

## The organization's address

Every organization has a **slug**, its address on the server: `acme` in
`https://enterprise.example.com/acme`, the organization's own sign-in page.

- 3 to 40 characters of `a-z`, `0-9` and `-`, with no double dash, not
  starting or ending with a dash, and never shaped like an id.
- Unique across the server, and **set once**: chosen when the organization
  is created, by the operator or at sign-up (derived from the name if none
  is given), and never changed. When an organization is deleted its slug
  stays taken, so nobody else can take over its old links.
- Reserved names are refused (`422 slug_reserved`): host and
  infrastructure names such as `app`, `api`, `admin`, `console`, `mail`,
  `docs` or `status`, every top-level path of the web app such as
  `settings`, `signup` or `reset-password`, and whatever the server lists
  in `ORG_RESERVED_SLUGS`.
- Wherever a URL names an organization (`/v1/orgs/{org}/...`, the OAuth and
  MCP URLs under `/orgs/{org}`, and their discovery documents), `{org}` is
  the slug or the id. Tokens are bound to the id, so they work under
  either.

Slugs are public by design: anyone can find out whether an address is
taken, from a sign-in page or sign-up. Who belongs to an organization is
not.

Slugs are also valid DNS labels, so they could serve as subdomains
(`acme.enterprise.example.com`), but sign-in uses the path for now.

## Joining an organization

Someone becomes a user in one of five ways:

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
5. **Sign-up.** Where the server allows
   [sign-up](/docs/concepts/authentication/#sign-up), someone who proves
   their address by email creates a new organization and becomes its first
   owner.

Everyone else is turned away, with the same response a failed login gets.
[Authentication](/docs/concepts/authentication/) covers each path in detail.
