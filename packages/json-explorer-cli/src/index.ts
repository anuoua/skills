#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  entries,
  loadJSON,
  navigate,
  search,
  type Entry,
  type JsonValue,
  type SearchResult,
} from "./explorer.ts";

function getVersion(): string {
  try {
    const pkgPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function printHelp(): void {
  console.log(`
json-explorer v${getVersion()}

Explore a JSON file or URL layer by layer.

Usage:
  json-explorer <source> [path]              explore one layer (default)
  json-explorer search <source> <query>      find keys/values across the tree
  json-explorer --version | -v
  json-explorer --help | -h

Arguments:
  source              Path or http(s):// URL to the JSON document
  path                Dot/bracket path to a nested value, e.g. users[0].name
  query               Substring to search (case-insensitive)

Flags (explore):
  --raw               Print only the value at <path> as JSON
  --max-len <N>       Max preview length for scalar values (default 40)

Examples:
  json-explorer data.json
  json-explorer data.json users
  json-explorer data.json users[0].name
  json-explorer https://example.com/api.json meta.count
  json-explorer data.json users[0].name --raw
  json-explorer search data.json email
`);
}

interface ParsedArgs {
  positionals: string[];
  raw: boolean;
  maxLen: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let raw = false;
  let maxLen = 40;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--raw") {
      raw = true;
      continue;
    }
    if (a === "--max-len") {
      const v = argv[++i];
      const n = Number(v);
      if (v === undefined || Number.isNaN(n)) {
        throw new Error(`--max-len expects a number, got "${v ?? ""}"`);
      }
      maxLen = n;
      continue;
    }
    if (a.startsWith("--max-len=")) {
      const n = Number(a.slice("--max-len=".length));
      if (Number.isNaN(n)) {
        throw new Error(`--max-len expects a number, got "${a}"`);
      }
      maxLen = n;
      continue;
    }
    positionals.push(a);
  }
  return { positionals, raw, maxLen };
}

function printLayer(pathStr: string | undefined, list: Entry[]): void {
  if (list.length === 0) return;

  const label = pathStr ? `\n  ${pathStr}` : "\n  .";
  const prefix = pathStr ? `${pathStr}.` : "";

  if (list.length === 1 && list[0]!.key === "(value)") {
    console.log(`${label} = ${list[0]!.preview}`);
    return;
  }

  console.log(label);
  const maxKeyLen = Math.max(
    ...list.map((e) => prefix.length + e.key.length),
    3,
  );
  const maxTypeLen = Math.max(...list.map((e) => e.type.length), 4);

  for (const entry of list) {
    const fullKey = prefix + entry.key;
    const preview =
      entry.type.startsWith("array") || entry.type.startsWith("object")
        ? ""
        : entry.preview;
    console.log(
      `  ${fullKey.padEnd(maxKeyLen)}  ${entry.type.padEnd(maxTypeLen)}  ${preview}`,
    );
  }
}

function printSearch(query: string, results: SearchResult[]): void {
  if (results.length === 0) {
    console.log(`No matches for "${query}".`);
    return;
  }

  const noun = results.length === 1 ? "match" : "matches";
  console.log(`\n  ${results.length} ${noun} for "${query}"\n`);

  const maxPathLen = Math.max(...results.map((r) => r.path.length), 4);
  const maxMatchedLen = Math.max(...results.map((r) => r.matched.length), 6);
  const maxTypeLen = Math.max(...results.map((r) => r.type.length), 4);

  for (const r of results) {
    console.log(
      `  ${r.path.padEnd(maxPathLen)}  ${r.matched.padEnd(maxMatchedLen)}  ${r.type.padEnd(maxTypeLen)}  ${r.preview}`,
    );
  }
}

async function runExplore(
  source: string,
  pathStr: string | undefined,
  opts: { raw: boolean; maxLen: number },
): Promise<void> {
  const data = await loadJSON(source);
  const current: JsonValue = pathStr ? navigate(data, pathStr) : data;

  if (opts.raw) {
    console.log(JSON.stringify(current, null, 2));
    return;
  }

  printLayer(pathStr, entries(current, { maxLen: opts.maxLen }));
}

async function runSearch(source: string, query: string): Promise<void> {
  const data = await loadJSON(source);
  printSearch(query, search(data, query));
}

function fail(err: unknown): never {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(`json-explorer v${getVersion()}`);
    process.exit(0);
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    fail(err);
  }

  const [sub, ...rest] = parsed.positionals;
  if (sub === "search") {
    const [source, query] = rest;
    if (!source || !query) {
      printHelp();
      process.exit(1);
    }
    try {
      await runSearch(source, query);
    } catch (err) {
      fail(err);
    }
    return;
  }

  const source = sub;
  const pathStr = rest[0];
  if (!source) {
    printHelp();
    process.exit(1);
  }
  try {
    await runExplore(source, pathStr, {
      raw: parsed.raw,
      maxLen: parsed.maxLen,
    });
  } catch (err) {
    fail(err);
  }
}

main();
