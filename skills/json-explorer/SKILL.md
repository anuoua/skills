---
name: json-explorer
description: Use when an Agent needs to read, browse, or answer questions about the contents of a JSON document (a local file or an `http(s)://` URL) using the `json-explorer` CLI. Covers exploring one layer at a time, drilling into nested values by path, locating keys or values with full-tree search, and extracting a single value as JSON. Trigger whenever the task involves inspecting an unknown/large JSON file, figuring out its shape, finding where a key or value lives, reading a value at a known path, or progressively walking a JSON structure — even if the CLI isn't named explicitly.
---

# Exploring JSON documents with `json-explorer`

`json-explorer` is a **stateless** CLI that loads a JSON document from a local
file or a URL and prints a readable, aligned view of it **one layer at a time**.
There is no server and no session: **every command takes the `<source>` and
re-loads the document.**

`<source>` is auto-detected: `http(s)://…` is fetched over the network; anything
else is a local file path. Output is **plain monospace text, no colors** —
designed for an Agent to read directly.

## Prerequisites

- Node.js >= 22.18.
- The CLI available as `json-explorer` (install with
  `npm install -g @askills/json-explorer-cli`, or prefix every command with
  `npx @askills/json-explorer-cli`).

## The #1 practical tip: download the document first

Because the tool is stateless, **each command re-loads the document.** For a
remote URL that means a network fetch on every call. So when you'll run more
than one command against the same document, fetch it once and explore the local
copy:

```bash
curl -fsSL <url> -o data.json
json-explorer data.json
json-explorer data.json users
```

Only explore directly from a URL for a one-off lookup.

## The core workflow: skim → drill → search → extract

```
1. <source>                      → what's at the top? (keys, types, previews)
2. <source> <path>               → drill one layer deeper
3. search <source> "<query>"     → locate a key/value anywhere in the tree
4. <source> <path> --raw         → extract one value as JSON (for scripting)
```

Every layer lists each child on its own line — the full path of the key, a type
label, and a short preview of scalar values:

```
  .
  users  array[2]
  meta   object
```

## Commands

### `<source> [path]` — explore one layer (the default)

With no `path`, lists the top level. With a `path`, lists the children **at that
path** (the path itself becomes the row prefix, so you can copy-paste a row's
key to descend further).

```bash
json-explorer data.json
json-explorer data.json users
json-explorer data.json users[0]
```

```
# json-explorer data.json users[0]

  users[0]
  users[0].name  string  "alice"
  users[0].role  string  "admin"
```

When the value at `path` is a **scalar** (string/number/boolean/null), it is
printed on one line instead of a table:

```
# json-explorer data.json meta.count

  meta.count = 2
```

Type labels: `string`, `number`, `boolean`, `null`, `object`, and
`array[<length>]`. In the **explore** table, object and array rows show no
preview (drill in to see an object's keys). In **search** results, every row has
a preview, and containers show a summary (`object{<key-count>}` /
`array[<length>]`).

### `search <source> "<query>"` — full-tree search

Recursively searches the **whole document** and returns every node whose **key**
or **value** matches the query (case-insensitive substring). Each result shows
the path, what matched (`key` or `value`), the type, and a preview. The path is
copy-pasteable into the explore command or `--raw`.

```bash
json-explorer search data.json email
json-explorer search data.json alice
```

```
# json-explorer search data.json name

  2 matches for "name"

  users[0].name  key   string  "alice"
  users[1].name  key   string  "bob"
```

This is the fastest way to answer "where is X?" or "does anything mention Y?".
Matching covers key names, array indices, and scalar values of any type
(numbers/booleans match their string form, e.g. `search … 2`).

### Flags

- **`--raw`** — with explore, print **only** the value at `<path>` as JSON
  (`JSON.stringify`, 2-space indent). Scalars come out JSON-encoded (a string
  is quoted); objects/arrays come out pretty-printed. Omit `<path>` to print the
  whole document as JSON. Ideal for piping into another tool or for `jq`-style
  extraction.
- **`--max-len <N>`** — cap the preview length for scalar string values
  (default `40`); longer strings are truncated with `...`.
- **`--help` / `-h`**, **`--version` / `-v`** — usage and version.

```bash
json-explorer data.json users[0].name --raw        # → "alice"
json-explorer data.json meta --max-len 10
```

## Path syntax

Two interchangeable forms, combinable:

- **Dot notation:** `users.0.name`, `meta.count`
- **Bracket notation:** `users[0]`, `users[0].name`, `a[0][1]`
- **Quoted keys** (for keys that contain `.` or spaces): `obj["a.b"]`,
  `obj['first name']`

Prefer brackets for array indices (`users[0].name`) — it reads unambiguously and
works for keys with dots via quotes.

## Decision guide — which command for which question

| You want to…                    | Run                                       |
| ------------------------------- | ----------------------------------------- |
| See the top-level shape         | `<src>`                                   |
| Look inside one object/array    | `<src> <path>`                            |
| Read a specific scalar value    | `<src> <path>` (prints `path = value`)    |
| Extract a value for scripting   | `<src> <path> --raw`                      |
| Find where a key or value lives | `search <src> "<q>"`, then `<src> <path>` |
| See longer string previews      | `<src> <path> --max-len 120`              |

So a typical investigation is: **`search` to locate → `<src> <path>` to read it
(or `--raw` to extract it).**

## Gotchas

- **Every call re-loads the document.** For remote URLs, download once (see the
  #1 tip) — otherwise each command re-fetches over the network.
- **It explores one layer at a time, not the whole tree.** There is no "dump
  everything" mode by design — a large JSON expanded fully would blow up context.
  Drill by path, or use `search` to jump straight to a node.
- **Paths are exact.** A missing key throws `Key "x" not found`; a bad array
  index throws `Index N is out of bounds`; a non-numeric index throws
  `Expected array index, got "abc"`; descending into a scalar throws
  `Cannot access "…" — current value is <type>`. The CLI prints the error and
  exits non-zero — read it, then fix the path. Run `<src>` (no path) or `search`
  to discover the right key/index.
- **`--raw` output is JSON-encoded.** A string value prints with quotes
  (`"alice"`); a number prints bare (`2`). This keeps it machine-parseable. If
  you need the raw scalar without quotes, strip them downstream.
- **Search matches keys, indices, and scalar values** — not substrings inside
  object/array containers themselves. To find a node, search for its key name or
  its value, then read the returned path.
- **`search` with no matches is not an error.** It prints `No matches for "<q>".`
  and exits `0`. Don't rely on a non-zero exit code to detect "not found" from
  `search` — a missing key in _explore_ does exit non-zero, but `search` never
  does.
