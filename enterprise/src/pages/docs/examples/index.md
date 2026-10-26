---
layout: ../../../layouts/Docs.astro
title: Use cases
lead: One engine for the business apps you would otherwise build one at a time. Each example is a complete model with its actions, run end to end by agents, assistants, and people, including the requests that are refused.
---

Every example below is the same system with a different model. The object
types, who sees which objects, and the actions that change them are all
data you load through the public API, or define in the web app, and can
change later while the system runs. Nothing in the server or the web app is
specific to any of them.

| Example | What it models | What it shows |
|---|---|---|
| [Machine maintenance](/docs/examples/maintenance/) | Machines, incidents, assignments, work orders, and a channel per incident | An agent reports and assigns in the incident's channel, a technician's assistant reads it and does the work over MCP, a supervisor approves the close. Technicians see only the incidents assigned to them, and their channels, and hold no write permission; a high-severity close needs a second person. |
| [Document management](/docs/examples/documents/) | Folders and documents with every version as a file | Documents shared with people and teams, as viewers or editors. Files are readable exactly by whoever sees the document, and unsharing ends that at once. Two people adding a version at once get a conflict, not a lost version. |
| [Car sales](/docs/examples/car-sales/) | Stock, leads, test drives, reservations, deals, trade-ins, financing, and invoices | Salespeople see only their own customers and finance never sees leads. VINs are checked by the organization's own format, a car can be reserved once, a large discount needs a manager, and closing a deal sells the car, numbers the invoice, and emails it to the customer at once. |
| [A small agentic dev team](/docs/examples/dev-team/) | Repositories, issues, tasks, pull requests, reviews, and per-agent budgets | Coding agents claim tasks (one claimant, even when two race), spend only their own budgets, and submit code. CI receives signed webhooks and reports back safely; nobody reviews their own pull request, and agents approve agents only where a maintainer allows it. |
| [Smart home and household](/docs/examples/home/) | Rooms, devices, scenes, automations, chores, a maintenance calendar, plans, and shopping | A hub agent reports devices and carries out what the household asks for. A caretaker agent's schedules put the monthly checks and weekly chores on the calendar, kids may lock doors but not unlock them, and a guest's access ends on its own when the stay does. |

## What they have in common

- **The rules are in the model.** Typed properties, links with cardinality,
  and format rules are checked on every write, whoever makes it.
- **Access is data.** A type is open to every member, restricted to teams,
  or narrowed to the objects that name each member or their teams: an
  assignee, an owner, a list of viewers. Postgres enforces it.
- **Changes are named operations.** Each example's
  [business actions](/docs/concepts/actions/) check who is calling and what
  the data looks like, apply all their edits or none, and record who applied
  them and how.
- **Agents, assistants, and apps meet the same rules.** An agent account
  over REST, a person's assistant over MCP, and an app with a session token
  read and change the same objects.

Each example also lists what it does not do yet. Those gaps are collected in
[Current limits](/docs/#current-limits).
