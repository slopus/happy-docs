---
layout: ../../layouts/Docs.astro
title: How it fits
lead: Happy Enterprise holds your organization's business model, enforces its rules, and comes with a web app for the people who use it. You bring the agents, the models they run on, and your existing data, and you can add apps of your own.
---

```text
web app         REST, as a signed-in person ──┐
your own app    REST, as a signed-in person ──┤
MCP client      MCP, for a signed-in person ──┤
agent process   REST, as an agent account ────┤
import job      REST, as an agent account ────┤
                                              ▼
         Happy Enterprise: types, objects, links,
         permissions, validation, event stream
                                              │
                                              ▼
                                           Postgres
```

Every arrow reaches the same objects through the same checks: the type's
property rules and custom validators, the caller's permissions, and the
organization boundary. An incident an agent updates is the incident a person
sees in the web app, and both changes arrive on the same
[event stream](/docs/concepts/live-events/).

## What runs the agent

You do. Happy Enterprise does not run agents, schedule them, or hold prompts.
An agent is one of two things:

- **An assistant in an MCP client**, such as a desktop chat app or a coding
  tool that supports MCP's authorization flow. A person adds the
  organization's MCP endpoint, signs in, and the assistant works on their
  behalf.
- **A process you run**: a worker, a scheduled job, or a service built with
  an agent framework. It calls the REST API with its own credentials.

## Where its model comes from

From the agent's own runtime. The MCP client or your process calls whichever
model provider you chose. Happy Enterprise never calls a model and never sees
prompts or completions: it sees API requests, checks them, and applies them.

## How it connects

There are two kinds of agent identity, and they behave differently. Pick the
one that matches who is responsible for what the agent does.

| | Delegated assistant | Agent account |
|---|---|---|
| Acts as | the person who signed in and consented | its own `agent` user |
| Connects with | [MCP](/docs/concepts/mcp/), at `/orgs/{org}/mcp` | the REST API |
| Credential | an OAuth grant, from the person's sign-in and consent | an API token (`heat_…`), or a JWT from your identity provider |
| May do | what both the grant's scopes and the person's current permissions allow; never owner actions or schema changes | what the teams it belongs to allow, like any member |
| Business actions | the person's action grants, with the `actions:apply` scope; one MCP tool per action | its teams' action grants, through `POST /v1/actions/{type}/apply` |
| Changes are recorded as | the person (`created_by`, `updated_by`) | the agent user |
| Second factor | the person's, when the organization requires one | none: agents are exempt |
| Ends when | the person revokes the grant, loses the permission, or is deactivated | an owner revokes the token or deactivates the agent |

Either way, the safest thing to give an agent is a
[business action](/docs/concepts/actions/) rather than raw write access: a
named operation with typed inputs, criteria checked on what commits, all or
nothing, and safe to retry. Grant the action to the agent's team and leave
`edit_objects` out. The audit log records which kind of identity applied it,
with which credential, through REST or MCP.

Use a **delegated assistant** when a person is directing the work and should
answer for it. Use an **agent account** for unattended work: an import, a
nightly reconciliation, a triage bot. Give the account its own team with only
the permissions it needs, and restrict the object types it should not see.

API tokens work on the REST API only, not on the MCP endpoint. An agent
account that is driven by a model reaches the server through tools you write
around the REST API.

## Where existing records come from

From your current systems, through the REST API. A typical import:

1. Create an agent account for the import, in a team with `edit_objects`
   (and `manage_ontology`, if it also creates the types).
2. Define the object types and link types
   ([schema API](/docs/api/ontology-schema/)). Give each type a property for
   the record's id in the source system, with the `unique` rule.
3. Create objects one at a time
   ([objects API](/docs/api/ontology-objects/)), then link them. Each
   object is checked against its type and validators as it is written.

For records that must arrive together, such as an order and its lines,
define an import [action](/docs/concepts/actions/) whose code creates them:
up to 100 edits in one transaction, with an idempotency key per source
record. Otherwise there is no bulk endpoint and no transaction across
requests, so make the import safe to re-run: on a `409` for the unique source id, the object is
already there; look it up and continue. Creating a link that already exists
returns `200`, so link steps can simply be repeated.

## The human interface

People use the [web app](/docs/web-app/) that comes with Happy Enterprise:
objects in tables and calendars, the ontology editor, action forms, the
audit log, the live feed, and the organization's people, teams, and
security settings. It is an ordinary client of the REST API, signed in as
the person, so it shows them what their permissions allow and nothing more.

You can build your own apps on the same API, next to it or instead of it.
Such an app:

- signs people in with an emailed code
  ([login API](/docs/api/auth/)) or with JWTs from your identity provider,
- reads and writes objects, and applies actions, through the REST API,
  under the person's permissions,
- follows the [event stream](/docs/api/events/) to show changes from agents
  and other people as they happen.

## What is not there yet

Access cannot yet follow links between objects (only the people and teams
an object names itself), and filters on properties are not indexed yet
([Performance](/docs/self-hosting/performance/)). See
[Current limits](/docs/#current-limits). For all of the above working
together, see the [use cases](/docs/examples/).
