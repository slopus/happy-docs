---
layout: ../../../layouts/Docs.astro
title: Custom validators
lead: When format rules are not enough, a property can be checked by a Python function. It runs in Pydantic Monty, a sandboxed Python interpreter written in Rust, and a write is accepted only if every call passes.
---

## Writing one

A validator is Python code that defines `validate(value)`:

```python
def validate(value):
    # value is the property's normalized JSON value: str, int, float, bool, list, dict
    if not value.startswith("PRJ-"):
        return "project codes start with PRJ-"
    digits = value[4:]
    if not digits.isdigit() or len(digits) != 4:
        return False
    return True
```

It **passes** by returning `True` or `None`, and **fails** by returning
`False` (reported as "rejected by the validator"), by returning a string (the
failure message, cut at 300 characters), or by raising (the exception is the
message). Returning anything else fails too. Anything else that goes wrong also fails the value: running out
of time or memory, a crash, or touching anything outside the sandbox.

Validators belong to the organization and are managed with `manage_ontology`:

```http
POST /v1/ontology/validators
{ "name": "project_code", "description": "PRJ- and four digits", "code": "def validate(value): ..." }
```

The server first checks, in the sandbox, that the code defines `validate`.
Each `POST` with an existing name adds the **next version**. Versions are
immutable: the organization API's database role may only insert and read them. Code is
limited to 20,000 characters.

`POST /v1/ontology/validators/{name}/test` runs a version (the latest by
default) on up to 100 sample values without writing anything:

```json
{ "name": "project_code", "version": 2, "results": [
  { "valid": true },
  { "valid": false, "message": "project codes start with PRJ-" }
] }
```

## Using one

A property refers to a validator with a rule that pins one version:

```json
{ "api_name": "code", "type": { "kind": "string" }, "required": true,
  "rules": [{ "rule": "validator", "name": "project_code", "version": 2 }] }
```

The rule works on any property type and on nested values (array elements,
struct fields). Because the rule pins a version, publishing version 3 changes
nothing until a `PUT` of the object type uses it. That `PUT`, like any rules
change, applies to new writes at once and to stored objects in the background
(see [Ontology](/docs/concepts/ontology/)), validators included.

## When they run

On every object write, after the declarative rules pass, the server runs every
validator call the object's values owe, grouped as one sandbox run per
validator. The write is accepted only if all of them pass. Failures appear in
the `422 validation_failed` details with the path of the value.

Time limits:

- object writes: all calls within **5 s**, and at most 1000 calls per object;
  a write that runs out of time is refused with `422`,
- the background job that checks stored objects after a rules change: a batch
  of objects within **60 s**; if the batch runs out of time, each object is
  retried alone within 5 s, and an object that still runs out is marked
  invalid.

If no sandbox is configured (`MONTY_WORKER=off`, or no worker binary next to
the server), writes that owe validator calls get `503
validators_unavailable`; writes that owe none are unaffected. Stored objects
of a type whose rules owe calls stay `pending` until a sandbox is available.

## The sandbox

Monty is a Python interpreter written in Rust. It offers no host functions,
filesystem, environment, network, or imports beyond its built-in modules: a
name the code does not define is a `NameError`, and any OS call (files,
environment, clock, sleep) ends the run as a failure.

| Limit | Per call |
|---|---|
| Execution time | 250 ms |
| Heap | 32 MiB |
| Recursion depth | 200 |
| Wall clock | 2 s, after which the worker process is killed |

Results depend only on the code and the value: the clock is fixed at the
moment the run starts and `random` is seeded per run.

Runs happen in worker subprocesses (`happy-enterprise-monty-worker`, deploy it
next to the server binary) with an empty environment and a memory-limited
allocator. Each worker serves one run (one request's calls to one validator)
and is then replaced, so nothing a validator does survives into another run
or reaches another organization.

<div class="note">

This is language-level isolation in an unprivileged process, not an OS
sandbox. Monty's sandboxing and resource limits are tested with escape
attempts and resource bombs. Happy Enterprise treats a validator as a
function of its value and assumes nothing else about it.

</div>
