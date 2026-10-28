---
layout: ../../../layouts/Docs.astro
title: Members, agents, invites
lead: The member directory, deactivation, agent users and their API tokens, and invites.
---

Members are returned as [user objects](/docs/api/me/#the-user-object).

## Members

### GET /v1/members

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_members</span></p>

Every user of the organization, active and deactivated, oldest first.

```json
[
  { "id": "h3jd8s0q2l5x7c1v9b4n6m8k", "kind": "human", "email": "ada@acme.example",
    "display_name": "Ada Lovelace", "is_owner": true, "active": true, "...": "..." },
  { "id": "a7g3e9n1t5b2o8t4x6y0z2w4", "kind": "agent", "email": null,
    "display_name": "Release bot", "is_owner": false, "active": true, "...": "..." }
]
```

### GET /v1/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>view_members, except for yourself</span></p>

One user. Without `view_members`, any id other than your own is `404`.

### DELETE /v1/members/{user}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Deactivates a member: ends their sessions and OAuth grants, revokes their API
tokens, and keeps them from logging in. `204`. `409` for the last active
owner; `404` if unknown or already deactivated.

### DELETE /v1/members/{user}/sessions

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Ends every login and OAuth grant of a member, who stays active and may log in
again. Use it when a device is lost.

```json
{ "revoked": 3 }
```

### POST /v1/members/{user}/password-link

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

A [set-password link](/docs/concepts/authentication/#signing-in-with-a-password)
for an active human member, to pass on when they have forgotten their
password. It works once, within 24 hours, and redeeming it ends all of the
member's sessions. Needs `ORG_PASSWORD_AUTH`; `404` without it, and for
agents and unknown or deactivated members.

`201`:

```json
{ "url": "https://api.acme.example/reset-password?org=c8kq2m7xw3n5p9r1t4v6y0za#token=...",
  "token": "...", "expires_at": "2026-10-29T10:00:00Z" }
```

## Agents

Agents are users of kind `agent` that authenticate with API tokens. They
start as members of `everyone` only, so a new agent can do nothing its
creator cannot; owners can then add it to teams.

### POST /v1/agents

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>invite_members</span></p>

```json
{ "display_name": "Release bot", "about": "Publishes release notes." }
```

`201` with the agent and its first token, named `default`. The token is shown
only here.

```json
{
  "user": { "id": "a7g3e9n1t5b2o8t4x6y0z2w4", "kind": "agent", "display_name": "Release bot", "...": "..." },
  "token": {
    "id": "k8t2o6k4e0n9x1q5w3r7y1u5",
    "name": "default",
    "token": "heat_c8kq2m7xw3n5p9r1t4v6y0za_k8t2o6k4e0n9x1q5w3r7y1u5_Vh3k..."
  }
}
```

```sh
curl "$BASE/v1/me" -H "Authorization: Bearer heat_c8kq2m7xw3n5p9r1t4v6y0za_k8t2o6k4e0n9x1q5w3r7y1u5_Vh3k..."
```

### POST /v1/agents/{agent}/tokens

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Another token for an existing, active agent. Owners only, since the agent may
by now hold permissions (through teams) that its creator does not.

```json
{ "name": "ci" }
```

`201`:

```json
{ "id": "k1m5n9b3v7c2x6z0l4k8j2h6", "name": "ci", "token": "heat_c8kq2m7xw3n5p9r1t4v6y0za_k1m5n9b3v7c2x6z0l4k8j2h6_9fLq..." }
```

`name` is 1-100 characters.

### DELETE /v1/agents/{agent}/tokens/{token}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>owner</span></p>

Revokes one token. `204`.

## Invites

### GET /v1/invites

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>invite_members</span></p>

Invites that have not been accepted, revoked, or expired, oldest first.

```json
[
  { "id": "i5n1v7i3t9e2x6c0q4w8r2t6", "email": "grace@navy.example", "invited_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
    "created_at": "2026-10-24T10:00:00Z", "expires_at": "2026-10-31T10:00:00Z" }
]
```

### POST /v1/invites

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>invite_members</span></p>

Invites an address and emails it a link to
`INVITE_URL?org=<org id>&token=hei_<invite id>_<secret>`. A pending invite for
the same address is replaced.

```json
{ "email": "grace@navy.example" }
```

`201`:

```json
{ "id": "i5n1v7i3t9e2x6c0q4w8r2t6", "email": "grace@navy.example", "expires_at": "2026-10-31T10:00:00Z" }
```

While `EMAIL_PROVIDER=log`, the response also has `invite_url`, the link
the email would carry, to copy and pass on yourself.

`409` if the address already belongs to a member (active or deactivated).
`502` if the email could not be sent.

### DELETE /v1/invites/{invite}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>invite_members</span></p>

Revokes a pending invite. `204`.
