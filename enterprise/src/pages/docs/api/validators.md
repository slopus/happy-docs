---
layout: ../../../layouts/Docs.astro
title: Validators and formats
lead: Custom validators and formats are versioned Python functions run in the Monty sandbox. Every endpoint here needs manage_ontology.
---

See [Custom validators](/docs/concepts/validators/) for how they work and how
object types use them. Formats, validators for strings, have the same
endpoints under [`/v1/ontology/formats`](#formats).

A validator version in responses:

```json
{
  "name": "project_code",
  "version": 2,
  "description": "PRJ- and four digits",
  "code": "def validate(value):\n    ...",
  "created_by": "h3jd8s0q2l5x7c1v9b4n6m8k",
  "created_at": "2026-10-24T10:00:00Z"
}
```

### GET /v1/ontology/validators

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology</span></p>

Every version of every validator, by name and version, without `code`.

```json
{ "validators": [
  { "name": "project_code", "version": 1, "description": "PRJ- and four digits", "created_by": "...", "created_at": "..." },
  { "name": "project_code", "version": 2, "description": "PRJ- and four digits", "created_by": "...", "created_at": "..." }
] }
```

### POST /v1/ontology/validators

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology</span></p>

Adds the next version of a validator (version 1 for a new name).

```json
{
  "name": "project_code",
  "description": "PRJ- and four digits",
  "code": "def validate(value):\n    if not value.startswith('PRJ-'):\n        return 'project codes start with PRJ-'\n    return value[4:].isdigit() and len(value) == 8\n"
}
```

`201` with the new version, including its code. `name` matches
`[a-z][a-z0-9_]{0,62}`; `code` is 1-20,000 characters; `description` up to
2000. The code is checked in the sandbox first: `422 validation_failed` if it
does not define `validate(value)`, `503 validators_unavailable` without a
sandbox.

### GET /v1/ontology/validators/{name}

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology</span></p>

Every version of one validator, oldest first, with code.

```json
{ "name": "project_code", "versions": [ { "version": 1, "code": "...", "...": "..." }, { "version": 2, "code": "...", "...": "..." } ] }
```

### POST /v1/ontology/validators/{name}/test

<p class="ep-meta"><span><b>Auth</b>full</span><span><b>Permission</b>manage_ontology</span></p>

Runs a version on sample values without writing anything. `version` defaults
to the latest; up to 100 `values`; the run must finish within 5 seconds.

```json
{ "version": 2, "values": ["PRJ-0042", "ABC-1", "PRJ-12"] }
```

```json
{
  "name": "project_code",
  "version": 2,
  "results": [
    { "valid": true },
    { "valid": false, "message": "project codes start with PRJ-" },
    { "valid": false, "message": "rejected by the validator" }
  ]
}
```

`404` for an unknown name or version.

## Formats

`GET/POST /v1/ontology/formats`, `GET /v1/ontology/formats/{name}` and
`POST /v1/ontology/formats/{name}/test` work like the validator endpoints
above, in their own namespace, with these differences:

- `POST` refuses the built-in names `email`, `url`, `uuid` and `cuid` with
  `400`.
- `test` takes string values only (`400` otherwise).
- The list names the built-ins too:

```json
{ "builtin": ["email", "url", "uuid", "cuid"],
  "formats": [ { "name": "sku", "version": 1, "description": "...", "created_by": "...", "created_at": "..." } ] }
```
