---
layout: ../../layouts/Docs.astro
title: What Happy Enterprise is
lead: The engine behind all of an organization's business data. Its people, apps, and agents work on the same records under the same checks, and it changes safely as the business changes.
---

Each organization gets its own members, teams, permissions, and
**ontology**: typed object types and links that describe its business
(customers, projects, incidents, machines, and how they relate), and the
**business actions** that change them. People, assistants, and agent
accounts all work on the same objects under the same rules.

When the business changes, the model changes with it, while the system
runs. A new kind of record or a new field is usable at once. A new rule
applies to every write at once and to the stored objects in the background,
with each object marked valid, invalid, or pending, and invalid ones kept
visible rather than dropped. A removed field is gone at once and its values
never come back. Every object type and action keeps its versions, new
actions and validators are defined at runtime, and permissions and the
isolation between organizations apply throughout. See
[Versions and schema changes](/docs/concepts/ontology/#versions-and-schema-changes).

Happy Enterprise comes with a [web app](/docs/web-app/) for the people in
an organization and a console for the operator. It is one Rust binary on top
of one Postgres database, serving two HTTP APIs on two separate listeners:

- The **organization API** (default `0.0.0.0:8080`, the public one) is what
  your organizations' people, agents, and apps use, the web app included:
  login, members and teams, the ontology, actions, the live event stream,
  OAuth, and an MCP server.
- The **management API** (default `127.0.0.1:9090`) is for you, the operator:
  it creates organizations and registers the signing keys of their identity
  providers.

The design is inspired by Palantir's: access to every type is a matter of
permissions granted to teams and audited, and the web app, a person using an
assistant, and a background agent all refer to the same incident and meet
the same validation and permission checks. You can build your own apps on
the same API. [How it fits](/docs/how-it-fits/) shows where your agents,
models, data, and apps come in.

## What an organization gets

Everything below is per organization, and nothing in one organization can
see or affect another.

| | |
|---|---|
| People and agents | Human users log in with an emailed code. Assistants act for a signed-in person over MCP; agent accounts act as themselves with API tokens. See [How it fits](/docs/how-it-fits/#how-it-connects) and [Users, teams, permissions](/docs/concepts/organizations/). |
| Teams and permissions | The system teams `owners` and `everyone`, custom teams that are objects of the ontology, subteams that pass their members up, memberships that end on time, a history of every membership change, and seven permissions granted to teams. |
| Login and security posture | Email codes, invites, DNS-verified allowed domains, required two-factor authentication with TOTP or WebAuthn. See [Authentication](/docs/concepts/authentication/). |
| An ontology | Object types with typed properties and format rules, versioned schemas, custom validators in sandboxed Python, link types with cardinality, queries, and access per type, down to the objects shared with each member or their teams and to single properties. See [The ontology](/docs/concepts/ontology/). |
| Business actions | The organization's own operations, such as "open a work order": typed parameters, criteria, edits applied all or nothing, safe retries, webhooks and emails (to members or customers) after commit, and an audit log. See [Business actions](/docs/concepts/actions/). |
| Timeseries | Series of timestamped points, such as sensor readings, attached to objects and read under their access: idempotent batches, raw, bucketed and downsampled reads, the newest value, retention, and live updates. See [Timeseries](/docs/concepts/timeseries/). |
| Chat | Public and private channels, direct messages, and channels about one object that follow who sees it, for people and agents: threads, mentions, attachments, reactions, pins, read state, and typing. See [Chat](/docs/concepts/chat/). |
| Filesystems | Trees of folders and files: versioned uploads up to 25 MiB, paths, name search, a trash with restore, folders restricted to teams that hide everything under them, live updates, and MCP tools. See [Filesystems](/docs/concepts/filesystem/). |
| Live updates | Every change to the ontology as a resumable stream of server-sent events. See [Live events](/docs/concepts/live-events/). |
| An MCP server | At `/orgs/{org}/mcp`, behind the organization's own OAuth 2.1 authorization server. See [MCP and OAuth](/docs/concepts/mcp/). |
| A web app | Objects in tables and calendars, the ontology and its code editor, action forms, the audit log, the live feed, people, teams, security, and an operator console. See [Web app](/docs/web-app/). |
| Files | Avatars, an organization photo, and attachments up to 25 MiB, readable by whoever may see an object that refers to them. In a local directory or an S3 bucket. See [Files and email](/docs/concepts/files-and-email/). |

## How it is kept apart

Isolation between organizations is enforced three times over:

1. **Scoped transactions.** Request handlers never see a connection pool. The only database
   handle they get is a transaction opened for a verified credential, scoped
   to that credential's organization.
2. **Postgres row level security.** Every table has forced RLS. Every row of
   organization data records its organization, and one policy, for reads and
   writes, matches only rows of the transaction's organization. The runtime
   roles cannot bypass it.
3. **Tests.** Integration tests try to read and write across organizations
   in every table, and check that every table carries the policy.

[Organizations and isolation](/docs/concepts/isolation/) explains each layer,
and what it does not cover.

## The stack

- Rust (axum, sqlx, tokio): one binary, `happy-enterprise`.
- Postgres 16 or newer. All state lives there; ids are
  [cuid2](https://github.com/paralleldrive/cuid2), generated by the application.
- [Pydantic Monty](https://github.com/pydantic/monty), a Python interpreter
  written in Rust, for custom ontology validators.
- [rmcp](https://github.com/modelcontextprotocol/rust-sdk) for the MCP server.

## Current limits

What Happy Enterprise does not do yet. Each item comes off this list when
it ships.

- **Access does not follow links.** A team sees all objects of a type, or
  only
  [the ones that name the member or a team of theirs](/docs/concepts/ontology/#shared-and-assigned-objects)
  (an assignee, an owner, a list of viewers or teams), and
  [single properties](/docs/concepts/ontology/#restricted-properties) can be
  limited to some teams. But a manager does not see their reports' expenses,
  and a document does not inherit its folder's sharing. Writes can be
  narrowed further through [business actions](/docs/concepts/actions/).
- **Hidden properties still move an object's metadata.** An object's
  `version`, `updated_at` and validation state, and its type's validation
  summary, also cover the properties a reader may not see, so they can show
  that a hidden value changed or breaks a rule.
- **Actions see and change only what they are given.** Criteria see their
  parameters' objects, the links between them, and the kind and teams of the
  caller and the users those objects and parameters name. Edits change those
  objects, the objects the action creates, and memberships of the teams
  passed in. So an action cannot update every document in a folder, and its
  criteria cannot ask whether a car has any reservation.
- **Schedules have fixed parameters, and nothing reacts to events.** A
  [schedule](/docs/concepts/actions/#schedules) applies one action with the
  same parameters each time, so it cannot release whichever reservations
  have run out. No action runs because another was applied or an event
  arrived, and there is no signed inbound webhook endpoint: integrations
  report with an API token.
- **Times are UTC.** Schedules and anything an action computes from the time
  have no time zone per organization.
- **Emails go to one person each.** An action emails a member or an outside
  address, not a team.
- **Agent accounts cannot use MCP.** The MCP endpoint takes OAuth sessions,
  which start with an email sign-in, so agent accounts work over REST with
  API tokens.
- **Every reader is a member.** There are no share links for people outside
  the organization, in the API or in the web app.
- **No full-text search.** Filters match property values, not the contents
  of attached files.
- **No transactions outside actions.** Plain object and link writes are one
  operation each. A change that takes several steps is atomic only when it is
  defined as an action.
- **No property indexes.** Filters and sorts on properties scan the type's
  objects, so those that must look at every object, such as `starts_with` or
  `order_by` on a property, take 1.3 to 2.3 seconds at a million objects of a
  type. Lookups by id, link traversals, and `linked` filters use indexes.
  See [Performance](/docs/self-hosting/performance/).
- **Chat has no search, and MCP posts no attachments.** Messages cannot be
  searched yet, and assistants post text and fields only.
- **Single points cannot be deleted.** Points of a
  [timeseries](/docs/concepts/timeseries/) go when retention passes them or
  their series goes, and ingest limits count batches, not points.
- **Filesystems search names only.** A
  [filesystem](/docs/concepts/filesystem/) finds folders and files by name,
  not by content, reading the whole tree each time; uploads are single
  requests of up to 25 MiB; and every version is kept until its file is
  purged from the trash.
- **Files have no quota or cleanup.** Uploads are limited to 25 MiB each,
  but not in total, and attachments that no object refers to are kept. MCP
  clients cannot upload attachments, though they can write files in a
  filesystem.

## Where to go next

- [How it fits](/docs/how-it-fits/): what runs your agents, how they
  connect, and where your data and UI come from.
- [Quickstart](/docs/quickstart/): run it locally, create an organization,
  log in, and define an object type.
- [Use cases](/docs/examples/): complete examples, machine maintenance,
  document management, car sales, an agentic dev team, and a smart home,
  each run end to end.
- [API reference](/docs/api/): every endpoint, with examples.
- [Self-hosting](/docs/self-hosting/): roles, configuration, deployment.
