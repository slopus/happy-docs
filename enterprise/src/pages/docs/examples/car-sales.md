---
layout: ../../../layouts/Docs.astro
title: "Example: car sales"
lead: A dealership's stock, leads, test drives, reservations, deals, trade-ins, financing, and invoices. Salespeople see only their own customers, a large discount needs a second person, a car can be reserved once, and closing a deal sells the car, numbers the invoice, and emails it to the customer in one step.
---

This page walks through one complete scenario at Riverside Motors: the
model, the actions, and every request in order, including the ones that are
refused. Everything here uses the public API, so you can load the same model
into your own organization and replay it.

![The car type in the web app: a stock_number sequence and the vin format](/shots/example-car-sales.webp)

## Who takes part

| | Identity | Connects with | Team |
|---|---|---|---|
| **inventory-feed** | an agent account that imports cars from auctions | REST, with its API token | `inventory` |
| **Sam**, a salesperson | a person, in your app and through an assistant | REST, with a session token; MCP, with an OAuth grant of `ontology:read actions:apply` | `sales` |
| **Tess**, a salesperson | a person, in your app | REST, with a session token | `sales` |
| **Maya**, a sales manager | a person, in your app | REST, with a session token | `managers` |
| **Fiona**, in finance | a person, in your app | REST, with a session token | `finance` |

`inventory` and `managers` hold `edit_objects`; `sales` and `finance` hold no
write permission. Salespeople change leads, deals, and everything else only
through the actions granted to them.

## The model

| Object type | Holds |
|---|---|
| `car` | `stock_number` (a sequence), `vin` (the `vin` format, unique), `make`, `model`, `year`, `color`, `mileage`, `price`, `status`: `available`, `reserved`, or `sold` |
| `lead` | a prospective buyer: `customer_name`, `email` (the `email` rule), `phone`, `salesperson`, `source`, `interest`, `status` from `new` to `won` or `lost` |
| `test_drive` | `salesperson`, `at`, a unique `slot`, `status` |
| `reservation` | `salesperson`, `customer`, `until`, `status`: `active`, `released`, or `sold` |
| `deal` | `number` (a sequence), `salesperson`, the customer, `list_price`, `discount` and the discount request, `trade_in_credit`, `payment`: `cash` or `financing`; `final_price`, `status` |
| `trade_in` | the customer's old car: `vin` (the `vin` format), `make`, `model`, `year`, `mileage`, its appraised `value` |
| `financing` | `lender`, `amount`, `term_months` (6 to 96), `apr`, `status`, `decided_by` |
| `invoice` | `number` (a sequence), the customer, `vin`, `description`, prices, `total`, `payment`, `issued_at` |

Prices are whole euros. Links join them:

| Link type | From → to | Cardinality |
|---|---|---|
| `reservation_car` | reservation → car | **one to one** |
| `reservation_lead` | reservation → lead | many to one |
| `test_drive_car`, `test_drive_lead` | test drive → car, lead | many to one |
| `deal_car`, `deal_lead` | deal → car, lead | many to one |
| `trade_in_deal` | trade-in → deal | many to one |
| `financing_deal` | financing → deal | many to one |
| `invoice_deal` | invoice → deal | one to one |

Two cars are in stock to begin with: a 2023 Tesla Model 3 at 32,900 and a
2021 Honda Accord at 21,500. They got stock numbers 1 and 2.

### The VIN format

A VIN's ninth character is a check digit. The organization defines its own
[format](/docs/concepts/validators/#formats), a Python function run in the
sandbox, and uses it on `car.vin`, `trade_in.vin`, and the `vin` parameter of
`add_trade_in`:

```python
VALUES = {'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8, 'J': 1, 'K': 2, 'L': 3, 'M': 4,
          'N': 5, 'P': 7, 'R': 9, 'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9}
WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

def validate(value):
    if len(value) != 17:
        return 'a VIN has 17 characters'
    total = 0
    for i in range(17):
        c = value[i]
        if c in '0123456789':
            n = int(c)
        elif c in VALUES:
            n = VALUES[c]
        else:
            return 'a VIN has digits and capital letters other than I, O and Q'
        total = total + n * WEIGHTS[i]
    check = total % 11
    expected = 'X' if check == 10 else str(check)
    if value[8] != expected:
        return 'the check digit (9th character) should be ' + expected
    return True
```

### Who sees what

| Type | `sales` | `managers` | `finance` |
|---|---|---|---|
| `car` | all (every member sees the stock; only `inventory` edits it) | all | all |
| `lead`, `test_drive` | their own | all | none |
| `reservation`, `deal`, `trade_in`, `financing`, `invoice` | their own | all | all |

"Their own" is an `assigned` view grant with `salesperson` as the
[access property](/docs/concepts/ontology/#shared-and-assigned-objects):

```json
PUT /v1/ontology/object-types/deal/access
{ "restricted": true, "access_properties": ["salesperson"],
  "grants": [
    { "team_id": "<sales>", "permission": "view_objects", "scope": "assigned" },
    { "team_id": "<managers>", "permission": "view_objects" },
    { "team_id": "<finance>", "permission": "view_objects" } ] }
```

So finance works on deals, financing, and invoices without ever seeing a
lead, and one salesperson's customers do not exist for another.

## The actions

| Action | Granted to | Does |
|---|---|---|
| `add_lead` | `sales` | records a lead with the caller as its salesperson |
| `schedule_test_drive` | `sales` | books a car that is not sold for the caller's lead; one test drive per car and hour |
| `reserve_car` | `sales` | holds an available car for the caller's lead until a time, and marks the car `reserved` |
| `release_reservation` | `sales`, `managers` | its holder releases it at any time; anyone who sees it, once it has run out |
| `open_deal` | `sales` | starts a deal on the car the caller reserved for that lead, at the car's price |
| `request_discount` | `sales` | up to 1,000 applies at once; above that, a named manager decides and is emailed |
| `decide_discount` | `managers` | approves or rejects a requested discount; not by the deal's salesperson |
| `add_trade_in` | `sales` | records the customer's old car on the caller's open deal |
| `appraise_trade_in` | `managers` | values a pending trade-in and credits it to its deal |
| `request_financing` | `sales` | applies for a loan for the caller's open financed deal |
| `decide_financing` | `finance` | approves an application at a rate, or declines it; emails the salesperson |
| `close_deal` | `sales` | sells the car, closes the deal, its reservation, and its lead, issues the numbered invoice, emails it to the customer, and calls accounting's webhook |

### One reservation per car

`reserve_car` checks that the car is `available`, but the guarantee that a
car has at most one reservation comes from the model: the `reservation_car`
link type is one to one. Whatever writes a second reservation link, an
action or an owner over REST, gets `409`.

### Only the car you reserved

`open_deal` takes a lead, a car, and a reservation. `linked` criteria make
sure they belong together:

```json
{ "name": "reserved",
  "message": "open a deal on the car you reserved for this lead",
  "condition": { "op": "and", "conditions": [
    { "op": "eq", "left": { "object": "reservation", "property": "status" }, "right": { "value": "active" } },
    { "op": "eq", "left": { "caller": "id" }, "right": { "object": "reservation", "property": "salesperson" } },
    { "op": "linked", "link": "reservation_car", "from": { "param": "reservation" }, "to": { "param": "car" } },
    { "op": "linked", "link": "reservation_lead", "from": { "param": "reservation" }, "to": { "param": "lead" } } ] } }
```

The links are read again when the objects are locked, so if one is removed
before the deal commits, the action is a `409 version_conflict` at `links`.

### Discounts with four eyes

`request_discount` applies up to 1,000 at once. Above that it needs an
`approver`, who may not be the caller, and only then emails them, through an
effect with `when`:

```python
LIMIT = 1000

def check(ctx):
    p = ctx['params']
    if p['amount'] <= LIMIT:
        return True
    if p.get('approver') is None:
        return 'a discount above ' + str(LIMIT) + ' needs a manager to approve it'
    if p['approver'] == ctx['caller']['id']:
        return 'you cannot approve your own discount'
    return True
```

```json
"effects": [
  { "kind": "email", "to": { "param": "approver" },
    "when": { "op": "gt", "left": { "param": "amount" }, "right": { "value": 1000 } },
    "subject": "Discount of {{param.amount}} on deal {{object.deal.number}} needs your decision",
    "text": "{{object.deal.customer_name}}, list price {{object.deal.list_price}}: {{param.reason}}" }
]
```

`decide_discount` is granted only to `managers`, and its `four_eyes`
criterion refuses the deal's own salesperson.

### Closing a deal

`close_deal` checks that the deal is the caller's and open, that the car and
lead are the deal's and the reservation the caller's (`linked`), that no
discount is waiting, and that a financed deal has its own approved financing:

```json
{ "name": "paid",
  "message": "a financed deal closes with its own approved financing",
  "condition": { "op": "or", "conditions": [
    { "op": "eq", "left": { "object": "deal", "property": "payment" }, "right": { "value": "cash" } },
    { "op": "and", "conditions": [
      { "op": "linked", "link": "financing_deal", "from": { "param": "financing" }, "to": { "param": "deal" } },
      { "op": "eq", "left": { "object": "financing", "property": "status" }, "right": { "value": "approved" } } ] } ] } }
```

Its Python edits create the invoice, whose `number` is a
[sequence](/docs/concepts/ontology/#sequences), link it to the deal, and mark
the deal `closed`, the car `sold`, the reservation `sold`, and the lead
`won`. The customer is not a member of the organization, so the email goes
to the deal's `customer_email`, which has the `email` rule:

```json
"effects": [
  { "kind": "email",
    "to_address": { "object": "deal", "property": "customer_email" },
    "when": { "op": "not", "condition": { "op": "is_null",
      "value": { "object": "deal", "property": "customer_email" } } },
    "subject": "Your invoice {{created.invoice.number}}: {{created.invoice.description}}",
    "text": "Dear {{object.deal.customer_name}}, ... Invoice {{created.invoice.number}}: ... total {{created.invoice.total}} EUR, paid by {{object.deal.payment}}." },
  { "kind": "webhook", "url": "https://accounting.example.com/hooks/invoices" }
]
```

All of it commits together, or none of it does. An invoice number is never
skipped, and never issued without its car being sold.

## Setting it up

As an owner, through the REST API:

1. Create the `vin` format (`POST /v1/ontology/formats`,
   [validators API](/docs/api/validators/)).
2. Create the four teams, give `inventory` and `managers` the
   `edit_objects` permission ([teams API](/docs/api/teams/)), and add the
   people and the agent.
3. Create the object types and link types
   ([schema API](/docs/api/ontology-schema/)), and restrict the types as
   above.
4. Create the action types and grant each to its teams
   ([actions API](/docs/api/actions/)).
5. Create the two cars.

## 1. The feed imports cars

inventory-feed posts cars directly; `inventory` may edit them.

**Refused by the format.** A VIN with a wrong check digit:

```http
POST /v1/ontology/objects/car
{ "properties": { "vin": "5YJ3E1EA9PF000002", "make": "Tesla", "model": "Model 3",
                  "year": 2010, "mileage": 91000, "price": 8900, "status": "available" } }

422 { "error": { "code": "validation_failed",
      "details": [{ "path": "vin", "message": "... format vin v1 ... the check digit (9th character) should be ..." }] } }
```

**Refused by uniqueness.** The Accord's VIN again: `409`.

**Created.** A Toyota Prius with a valid VIN: `201`, with `stock_number`
3, the next number. The feed did not send one, and could not have.

Salespeople see all three cars, but `PATCH`ing a price is `403`.

## 2. Leads stay with their salesperson

Sam adds a lead for Lena Park, and Tess one for Omar Haddad, both through
`add_lead`, which makes the caller the salesperson. Posting a lead directly,
for someone else, is `403`.

Sam and Tess each see one lead, their own; Maya sees both. Tess asking for
Lena's lead by id gets `404`.

## 3. Sam's assistant books a test drive

Sam's MCP client lists the available cars, most expensive first:

```json
{ "tool": "query_objects",
  "arguments": { "type": "car",
                 "filter": { "op": "eq", "property": "status", "value": "available" },
                 "order_by": { "property": "price", "direction": "desc" } } }
```

It books the Model 3 for Lena two days ahead (`action_schedule_test_drive`),
and Lena's lead moves to `test_drive`. The test drive's `slot` is the car and
the hour, and it is unique.

**Refused.** Asked to book the same car for Omar, Tess's lead, it gets an
error at `params.lead`: the lead does not exist for Sam. Asked to add a car
with `create_object`, it gets `forbidden`.

**Taken.** Tess tries the Model 3 for Omar half an hour after Sam's booking:
`409`, the slot is held. An hour later: `201`. Sam sees one test drive, Maya
both.

## 4. Two salespeople, one car

Tess reads the Model 3. Before Tess reserves it, Sam does:

```http
POST /v1/actions/reserve_car/apply
{ "params": { "car": "<model 3>", "lead": "<lena>", "until": "<in three days>" } }

201 { "created": [{ "type": "reservation", ... }], "updated": [{ "type": "car", ... }], ... }
```

**Conflict.** Tess's reservation, stating the version read before, is
`409 version_conflict`. Sent again without it, it is refused by the criterion:

```json
422 { "error": { "code": "criteria_failed",
      "details": [{ "path": "criteria.available", "message": "the car is not available" }] } }
```

Tess reserves the Accord for Omar instead. Releasing Sam's reservation is
refused at `params.reservation`, because Tess cannot see it.

**Refused by the model.** The owner, who may write directly, creates another
reservation and links it to the Model 3: `409`. The link type is one to one.

## 5. A deal and a discount

Sam opens a financed deal for Lena on the Model 3 (`open_deal`). It gets
`number` 1 and the car's price, 32,900.

Sam asks for a discount of 2,500 to match a competitor. Without an approver
it is refused at `criteria.approver` ("a discount above 1000 needs a manager
to approve it"), and with Sam as the approver, "you cannot approve your own
discount". With Maya: `201`, the deal's discount is `requested`, and one
effect is queued, the email to Maya.

**Denied.** Sam tries `decide_discount`: `403`, it is granted to `managers`
only. Closing the deal now lists both reasons it cannot close yet:

```json
422 { "error": { "code": "criteria_failed", "details": [
  { "path": "criteria.discount_settled", "message": "a discount request is waiting for a manager" },
  { "path": "criteria.paid", "message": "a financed deal closes with its own approved financing" } ] } }
```

Maya approves the discount, and Sam is emailed.

## 6. Trade-in and financing

Lena trades in a 2013 Ford F-150. Sam types its VIN with a letter O for a
zero: refused at `params.vin`, by the same format. With the right VIN: `201`.
Maya appraises it at 6,000, credited to the deal.

Sam applies for financing with Northbank, 24,400 over 60 months. Fiona, in
finance, sees the deal, but Lena's lead is `404`. Fiona approves without a
rate: refused at `criteria.rate` ("an approval states its rate"). With an
APR of 5.9: `201`, and Sam is emailed.

## 7. Closing, twice

Sam closes the deal, with an idempotency key:

```http
POST /v1/actions/close_deal/apply
{ "params": { "deal": "<deal>", "car": "<model 3>", "lead": "<lena>",
              "reservation": "<reservation>", "financing": "<financing>" },
  "idempotency_key": "close-deal-1" }

201 { "created": [{ "type": "invoice", ... }], ... }
```

Invoice 1 reads "2023 Tesla Model 3", total 24,400 (32,900 less the 2,500
discount and the 6,000 trade-in). The car is `sold`, the lead `won`, and the
deal `closed` at 24,400.

The answer is lost, so Sam sends it again: `200`, `replayed: true`, the same
application. No second invoice, no second email.

Tess opens a cash deal for Omar on the Accord and gives a discount of 500,
within the limit, so it applies at once and nobody is emailed. Closing it
issues invoice 2, total 21,000. Tess sees one invoice, the one for Omar;
Fiona sees both.

## What everyone saw

After commit, the background job sent five emails:

| To | Subject |
|---|---|
| `lena@example.net` | Your invoice 1: 2023 Tesla Model 3 |
| Maya | Discount of 2500 on deal 1 needs your decision |
| `omar@example.org` | Your invoice 2: 2021 Honda Accord |
| Sam | Discount on deal 1 decided |
| Sam | Financing with Northbank decided |

Lena and Omar are not members, so their invoices went to the addresses on
their deals, and end with "Sent for Riverside Motors by Happy Enterprise."
Accounting's webhook was called once per closed deal.

## What this shows

- **The model carries the hard rules.** The VIN check digit, unique VINs and
  slots, one reservation per car, and gapless invoice numbers hold for every
  write, from an action, an agent, or an owner.
- **Actions carry the business rules.** The discount threshold, the second
  person, and "only the car you reserved for this customer" are in the
  action definitions, the same for the app, the assistant, and the feed.
- **Several changes are one step.** Closing sells the car, issues the
  invoice, and emails the customer together; a retry is a replay.
- **Each team sees its part.** Salespeople see their own customers, finance
  the money, managers everything.

## What it does not do yet

- **Reservations do not expire on their own.** After `until`, anyone who
  sees a reservation may release it, but nothing releases it automatically;
  that needs scheduled actions.
- **No email to a team.** The discount email goes to one named manager, and
  an action cannot check that the person named is a manager. The decision
  itself still needs the `managers` grant.
- **Criteria see only the links between their parameters.** An action
  cannot ask whether a car has any reservation, so the car's `status` is kept
  by the actions, with the link type's cardinality behind it.
- **A taken slot does not say by whom.** The unique `slot` tells a
  salesperson an hour is taken, not who took it.
- **No money type and no invoice documents.** Prices are whole euros, and
  invoices are objects, not generated files.
