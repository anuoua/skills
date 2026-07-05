---
name: openapi-explorer
description: Use when an Agent needs to understand, browse, or answer questions about an API from its OpenAPI / Swagger spec (a `swagger.json` / `openapi.json` file or URL) using the `openapi-explorer` CLI. Covers finding endpoints, inspecting request/response shapes, browsing data models (schemas), and full-text search. Trigger whenever the task involves reading or exploring an OpenAPI/Swagger spec, figuring out how to call an endpoint, listing API operations, or understanding an API's data model — even if the CLI isn't named explicitly.
---

# Exploring OpenAPI/Swagger specs with `openapi-explorer`

`openapi-explorer` is a **stateless** CLI that loads an OpenAPI v3.x or Swagger v2
spec (JSON) from a URL or local file and prints readable, markdown-formatted
views of it — endpoints, schemas, tags, and search results. There is no server
and no session: **every command takes the `<source>` and re-loads the spec.**

`<source>` is auto-detected: `http(s)://…` is fetched over the network; anything
else is a local file path. **JSON only** (YAML is not supported).

## Prerequisites

- Node.js >= 22.18.
- The CLI available as `openapi-explorer` (install with
  `npm install -g @askills/openapi-explorer-cli`, or prefix every command with
  `npx @askills/openapi-explorer-cli`).

## The #1 practical tip: download the spec first

Because the tool is stateless, **each command re-loads the spec**. For a remote
URL that means a network fetch on every call. So when you'll run more than one
command against the same spec, fetch it once and explore the local copy:

```bash
curl -fsSL <spec-url> -o spec.json
openapi-explorer info ./spec.json
openapi-explorer paths ./spec.json --tag pets
```

Only explore directly from a URL for a one-off lookup.

## The core workflow: skim → group → list → drill → model → search

```
1. info <src>                        → what is this API? (title, version, counts)
2. tags <src>                         → how is it grouped?
3. paths <src> --tag <group>          → list endpoints in a group
4. endpoint <src> <path> <method> --full   → drill into one (full bodies)
5. schemas <src>                      → what data models exist?
6. schema <src> <Name>                → inspect a model's fields
7. search <src> "<query>"             → find anything by keyword
```

## Commands

### `info <source>` — API overview

Title, version, OpenAPI version, server URL, description, and counts.

```
# Swagger Petstore
Version: 1.0.7
OpenAPI Version: 2.0
Server: `https://petstore.swagger.io/v2`
## Summary
- Endpoints: 20
- Schemas: 6
- Tags: 3
```

Start here to learn what an API is and how big it is.

### `tags <source>` — groups with endpoint counts

```
| Tag | Endpoints |
|-----|-----------|
| `pet` | 8 |
| `store` | 4 |
```

Use the tag names as filters for `paths --tag <name>`.

### `paths <source> [--tag <t>] [--limit N] [--offset N]` — list endpoints

Each endpoint shows method, path, summary, operationId, and tags. `--tag`
filters; `--limit`/`--offset` paginate (default limit 50). The output tells you
the next `--offset` when there's more.

```bash
openapi-explorer paths ./spec.json --tag pet --limit 10
openapi-explorer paths ./spec.json --offset 50   # next page
```

### `endpoint <source> <path> <method> [--full]` — endpoint detail

Parameters (name/in/type/required), request body, responses (by status code),
and security. **`--full` resolves every `$ref`** so request/response schemas are
inlined — use it whenever you need the actual body shape. Without `--full` you
see `$ref` pointers like `$ref: "Pet"`.

```bash
openapi-explorer endpoint ./spec.json /pet/{petId} get --full
```

If the path/method doesn't exist, it suggests similar ones — read the error.

(`endpoint` has a short alias: `ep`.)

### `schemas <source> [--limit N] [--offset N]` — list data models

A table of component schemas (name, type, property count, description). Paginated.

### `schema <source> <name>` — model detail

Full property list with types, required flags, enums, examples, and nested
`$ref`s. If the name is wrong, it lists available schemas to pick from.

```bash
openapi-explorer schema ./spec.json Pet
```

### `search <source> "<query>"` — full-text search

Searches across endpoints, schemas, and property names; groups results by type.
The fastest way to answer "where is X handled?" or "is there anything about
payments?".

```bash
openapi-explorer search ./spec.json "order"
```

## Decision guide — which command for which question

| You want to… | Run |
|--------------|-----|
| Know what the API is / how big | `info` |
| See how it's organized | `info` → `tags` |
| List endpoints, maybe in one area | `paths [--tag <t>]` |
| Know how to call a specific endpoint | `endpoint <src> <path> <method> --full` |
| Find an endpoint by topic/name | `search "<query>"`, then `endpoint … --full` |
| Understand a data model's fields | `schema <src> <Name>` |
| Find where a field/topic appears | `search "<query>"` |

So a typical investigation is: **`search` to locate → `endpoint --full` (or
`schema`) to see the detail.**

## Gotchas

- **YAML is not supported.** If you only have a YAML spec, convert it to JSON
  first (e.g. `npx @apidevtools/swagger-cli bundle -o spec.json -r spec.yaml`),
  then point the CLI at the `.json`.
- **Use `--full` for bodies.** Without it, `endpoint` shows `$ref` pointers; you
  won't see the actual request/response field shapes.
- **Re-think the path format.** Paths include braces for params, e.g.
  `/pet/{petId}` — pass them verbatim to `endpoint`.
- **Pagination defaults to 50.** Large APIs need `--offset` to page through; the
  output prints the next offset to use.
- **Method is lowercase-tolerant.** `get`, `GET`, `Get` all work.
- **Every call re-loads the spec.** For remote specs, download once (see the #1
  tip) — otherwise each command re-fetches over the network.
