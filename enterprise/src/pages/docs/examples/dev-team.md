---
layout: ../../../layouts/Docs.astro
title: "Example: a small agentic dev team"
lead: Two people and two coding agents share issues, tasks, and pull requests. Agents claim work, spend their own budgets, and submit code; CI receives signed webhooks and reports back; reviews follow the team's rules; a maintainer's assistant approves over MCP. No server feature was added for it.
---

This page walks through one complete scenario: the model, the actions, the
CI integration, and every request in order, including the ones that are
refused. Everything here uses the public API, so you can load the same model
into your own organization and replay it. The model needed nothing beyond
the features the other examples use.

## Who takes part

| | Identity | Connects with | Teams |
|---|---|---|---|
| **Dana**, a maintainer | a person, in your app and through an assistant | REST, with a session token; MCP, with an OAuth grant of `ontology:read actions:apply` | `developers`, `maintainers` |
| **Eli**, a developer | a person, in your app | REST, with a session token | `developers` |
| **ada** and **bix** | coding agents, as agent accounts | REST, with API tokens | `developers`, `agents` |
| **ci-bot** | the CI system's agent account | REST, with an API token | `ci` |

**No team holds a write permission.** Everything below changes only through
actions, so an agent's API token can claim a task or submit a pull request,
but cannot edit a task's claimant or a pull request's CI result directly
(`403`).

## The model

| Object type | Holds |
|---|---|
| `repo` | `name` (unique), `default_branch`, and the review policy `agents_review_agents` |
| `issue` | `number` (a sequence), `title`, `body`, `reporter`, `status` |
| `task` | `title`, `claimant`, `claimed_at`, `status`: `open`, `claimed`, `in_review`, or `done` |
| `pull_request` | `number` (a sequence), `title`, `author`, `author_kind` (`human` or `agent`), `head_sha`, `status`, `ci_status` and `ci_sha`, `approved_by` and `approved_sha`, `merged_by`, `merged_at` |
| `review` | `reviewer`, `reviewer_kind`, `sha`, `verdict`: `approve` or `request_changes`; `body` |
| `budget` | `agent`, `limit`, `spent`, in credits |
| `run` | `agent`, `estimate`, `cost`, `status`, `started_at`, `finished_at` |

Commit shas are strings with a `regex` rule. Links join a task to its issue
and repository, a pull request to its task and repository, a review to its
pull request, and a run to its task and budget.

The seed creates the `api` repository, with `agents_review_agents` off, and
two budgets: 50 credits for ada and 20 for bix.

### Budgets are private

Every type is visible to every member except `budget`, which is restricted
with `agent` as its
[access property](/docs/concepts/ontology/#shared-and-assigned-objects):

```json
PUT /v1/ontology/object-types/budget/access
{ "restricted": true, "access_properties": ["agent"],
  "grants": [
    { "team_id": "<agents>", "permission": "view_objects", "scope": "assigned" },
    { "team_id": "<maintainers>", "permission": "view_objects" } ] }
```

Each agent sees its own budget and maintainers see all of them. Another
agent's budget does not exist for an agent, so it cannot even name one in an
action.

## The actions

| Action | Granted to | Does |
|---|---|---|
| `open_issue` | `developers` | files a numbered issue |
| `plan_task` | `maintainers` | adds a task for an open issue in a repository |
| `claim_task` | `developers` | takes an open task; a task has one claimant |
| `start_run` | `agents` | reserves credits from the caller's own budget for work on the caller's task |
| `finish_run` | `agents` | records what the run cost, and charges the budget that instead of the estimate |
| `submit_pr` | `developers` | opens a numbered pull request for the task the caller claimed; tells CI |
| `push_commits` | `developers` | moves the caller's pull request to a new head commit, resetting its approval and CI result; tells CI |
| `report_ci` | `ci` | records the CI result for the pull request's head commit only |
| `review_pr` | `developers` | approves the head commit or requests changes |
| `merge_pr` | `maintainers` | merges a pull request approved and passed at its head, and completes the task |
| `set_review_policy` | `maintainers` | allows or forbids agents approving agents' pull requests in a repository |

### One claimant per task

`claim_task` is one criterion and one update:

```json
{ "criteria": [
    { "name": "unclaimed", "message": "the task is claimed already",
      "condition": { "op": "eq", "left": { "object": "task", "property": "status" },
                     "right": { "value": "open" } } } ],
  "edits": [
    { "op": "update_object", "object": { "param": "task" },
      "properties": { "claimant": { "caller": "id" }, "claimed_at": { "now": true },
                      "status": { "value": "claimed" } } } ] }
```

The criterion alone would not be enough if two agents read the open task at
the same moment. But an action locks its objects and checks their versions
again before it writes, so of two concurrent claims one commits and the other
gets `409 version_conflict`, or, if it reads the task after the first
committed, `422` at `criteria.unclaimed`.

### Budgets

`start_run` takes the task, a budget, and an estimate. Its criteria check
that the task is the caller's, that the budget is the caller's, and, in
Python, that the estimate fits:

```python
def check(ctx):
    b = ctx['objects']['budget']['properties']
    left = b['limit'] - b['spent']
    if ctx['params']['estimate'] > left:
        return 'the run needs ' + str(ctx['params']['estimate']) + ' credits; ' + str(left) + ' are left'
    return True
```

The edits create the run, link it, and add the estimate to `spent`.
`finish_run` replaces the estimate with the cost, after a `linked` criterion
checks that the run was charged to that budget.

### Review rules

`review_pr` has five criteria:

| Criterion | Holds when |
|---|---|
| `open` | the pull request is `open` or `approved` |
| `of_repo` | it belongs to the repository passed (`linked`) |
| `current` | the review is of the pull request's `head_sha` |
| `not_author` | the caller is not its author |
| `agent_reviews` | the caller is a human, or the author is, or the repository's `agents_review_agents` is on |

```json
{ "name": "agent_reviews",
  "message": "agents review agents' pull requests only where the repository allows it",
  "condition": { "op": "or", "conditions": [
    { "op": "eq", "left": { "caller": "kind" }, "right": { "value": "human" } },
    { "op": "eq", "left": { "object": "pull_request", "property": "author_kind" }, "right": { "value": "human" } },
    { "op": "eq", "left": { "object": "repo", "property": "agents_review_agents" }, "right": { "value": true } } ] } }
```

Criteria see the caller's kind but not another user's, so `submit_pr`
records the author's kind on the pull request, `"author_kind": {"caller":
"kind"}`. Only actions write it, so it cannot be changed afterwards.

`merge_pr` checks that the pull request is approved at its head and that CI
passed the head, so a push after an approval needs a new approval and a new
CI result.

## CI as a webhook receiver

`submit_pr`, `push_commits`, and `merge_pr` each have a webhook effect to
CI. CI is an ordinary HTTPS server:

1. At setup, it reads each action type's webhook secret as an owner:
   `GET /v1/ontology/action-types/submit_pr/webhook-secret`, and the same
   for `push_commits` and `merge_pr`.
2. For each delivery, it picks the secret by the payload's `action` and
   checks `x-happy-enterprise-signature`: `sha256=` and the hex HMAC-SHA256
   of `"<x-happy-enterprise-timestamp>.<body>"`. Anything else is refused.
3. It builds the commit in `params.sha`, and reports back as ci-bot:

```http
POST /v1/actions/report_ci/apply
Authorization: Bearer heat_...
{ "params": { "pull_request": "<pr>", "sha": "a1b2c3d", "passed": true },
  "idempotency_key": "<x-happy-enterprise-delivery>" }
```

The delivery id is the same on every redelivery of a webhook, so using it
as the idempotency key turns a redelivered webhook into a replay, not a
second report. `report_ci` only accepts the pull request's current head, so
a slow build of an older commit cannot mark a newer one as passed. See
[Effects](/docs/concepts/actions/#effects) for the webhook format.

## Setting it up

As an owner, through the REST API:

1. Create the four teams, with no permissions, and the three agent accounts
   ([members API](/docs/api/members/), [teams API](/docs/api/teams/)). Add
   Dana, Eli, ada, and bix to `developers`, Dana to `maintainers`, ada and
   bix to `agents`, and ci-bot to `ci`.
2. Create the object types and link types
   ([schema API](/docs/api/ontology-schema/)), and restrict `budget` as
   above.
3. Create the action types and grant each to its teams
   ([actions API](/docs/api/actions/)), and give CI the three webhook
   secrets.
4. Create the repository and the two budgets.

## 1. Dana plans the work

Dana opens issue 1, "Rate-limit the login endpoint", and plans two tasks for
it in `api`: "Add a limiter" and "Document the limits". Eli trying
`plan_task` gets `403`: it is granted to maintainers only. ada trying to
`PATCH` itself in as the limiter's claimant also gets `403`.

## 2. Two agents, one task

ada and bix claim the limiter at the same moment:

```http
POST /v1/actions/claim_task/apply
{ "params": { "task": "<limiter>" } }
```

One gets `201`. The other gets `409 version_conflict`, or `422` at
`criteria.unclaimed` if it arrived after the first committed. Say ada won.
bix claiming the limiter again gets `criteria.unclaimed`, and takes the docs
task instead.

## 3. Runs and budgets

**Refused by a criterion.** bix asks for a 25-credit run on the docs task,
from a 20-credit budget:

```json
422 { "error": { "code": "criteria_failed",
      "details": [{ "path": "criteria.within_budget",
                    "message": "the run needs 25 credits; 20 are left" }] } }
```

**Refused as unknown.** bix tries to charge ada's budget instead: `422` at
`params.budget`. To bix, ada's budget does not exist; asking for it by id is
`404`.

bix starts a 15-credit run. ada starts an 18-credit run on the limiter and
finishes it at a cost of 12, so ada's budget shows 12 spent. Dana, a
maintainer, sees both budgets.

## 4. A pull request, and CI

ada submits the limiter as commit `a1b2c3d`, with an idempotency key. The
answer is lost and ada sends it again: `200`, `replayed: true`. There is one
pull request, number 1, with `author_kind: "agent"` and `ci_status:
"pending"`, and the task is `in_review`.

After commit, CI receives one `submit_pr` delivery, not two: the replay
applied nothing, so it queued no effect. CI verifies the signature and
reports `a1b2c3d` as passed with the delivery id as its key. A redelivery's
report is a replay.

## 5. Reviews

**Refused by the policy.** bix approves ada's pull request:
`criteria.agent_reviews`. Agents do not approve agents in `api`.

**Refused twice.** ada approves ada's own pull request. Both reasons come
back: `criteria.not_author` and `criteria.agent_reviews`.

Eli requests changes. ada pushes commit `e4f5a6b`: the pull request is
`open` again, and its CI result `pending`.

**Refused as stale.** CI's late report for `a1b2c3d` arrives now: `422` at
`criteria.head`, "the pull request moved on to another commit". The
`push_commits` delivery comes in, and CI reports `e4f5a6b` as passed.

## 6. Dana's assistant approves

Dana's MCP client lists the open pull requests (`query_objects` with
`status` = `open`) and finds one. It approves the commit it saw first:

```json
{ "tool": "action_review_pr",
  "arguments": { "pull_request": "<pr>", "repo": "<api>", "sha": "a1b2c3d",
                 "verdict": "approve", "body": "Approved by Dana's assistant" } }

→ error { "code": "criteria_failed",
          "details": [{ "path": "criteria.current", "message": "review the pull request's head commit" }] }
```

With `e4f5a6b`, the head, it succeeds. The approval is Dana's: the pull
request's `approved_by` is Dana, and the audit log records the application
as `kind: human`, `via: mcp`.

Eli tries to merge: `403`. Dana merges: the pull request is `merged`, the
task `done`, and CI's `merge_pr` webhook is sent.

## 7. Agents review agents

Dana turns `agents_review_agents` on for `api` (`set_review_policy`). bix
finishes its run at a cost of 9, and submits the docs as pull request 2,
commit `0c0ffee`. ada approves it, which the policy now allows.

Dana tries to merge before CI has reported: `422` at `criteria.ci_passed`.
CI reports, and Dana merges.

## What everyone saw

The audit log tells people, agents, and the assistant apart. Its three
reviews, newest first:

| Review | `kind` | `via` |
|---|---|---|
| ada approves pull request 2 | `agent` | `rest` |
| Dana's assistant approves pull request 1 | `human` | `mcp` |
| Eli requests changes on pull request 1 | `human` | `rest` |

Every refused request, and both replays, left no record and changed nothing.

## What this shows

- **Agents are members with rules, not admins with tokens.** The coding
  agents hold no write permission. They claim, spend, and submit only
  through actions that check the task is theirs and the budget is theirs.
- **Races have one winner.** Two agents claiming one task cannot both get
  it; the loser is told why.
- **Review policy is data.** Who may approve whom is in the criteria and in
  a repository flag a maintainer sets, and it applies to every caller alike.
- **Integrations get the same guarantees.** CI verifies where a webhook came
  from, reports through an action, and its retries and late results are
  harmless.
- **An assistant acts as its person.** Dana's assistant can approve because
  Dana can, and the log says it was Dana, through MCP.

## What it does not do yet

- **Agent accounts cannot use MCP.** The MCP endpoint takes OAuth sessions,
  which start with an email sign-in. Agents work over REST with API tokens.
- **Criteria see only the caller's kind.** They cannot look up another
  user, so the pull request records `author_kind` when it is submitted.
- **Criteria cannot test team membership.** The agent review policy is a
  repository property, on top of the team grant for `review_pr`.
- **Budgets do not reset.** There are no scheduled actions to refill them
  each period, and run costs are what the agents report, not metered.
- **There is no git.** Commits are the shas agents and CI report.
