import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadJSON,
  navigate,
  entries,
  parsePath,
  formatPreview,
  search,
  type JsonValue,
} from "../src/explorer.ts";

const dir = mkdtempSync(join(tmpdir(), "je-"));
const filePath = join(dir, "data.json");

const data: JsonValue = {
  name: "alice",
  age: 30,
  active: true,
  tags: ["x", "y", "z"],
  address: { city: "tokyo", zip: "100-0001" },
  nothing: null,
};

before(() => {
  writeFileSync(filePath, JSON.stringify(data));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadJSON (file)", () => {
  it("reads and parses a JSON file", async () => {
    const d = await loadJSON(filePath);
    assert.deepEqual(d, data);
  });

  it("throws for a non-existent file", async () => {
    await assert.rejects(() => loadJSON(join(dir, "nope.json")), /ENOENT/);
  });

  it("throws for invalid JSON", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json}");
    await assert.rejects(() => loadJSON(bad), /JSON/);
  });
});

describe("loadJSON (URL)", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/data.json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ hello: "world", n: 42 }));
      } else {
        res.statusCode = 404;
        res.end("not found");
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("loads JSON from an http URL", async () => {
    const d = await loadJSON(`${baseUrl}/data.json`);
    assert.deepEqual(d, { hello: "world", n: 42 });
  });

  it("rejects on a non-200 response", async () => {
    await assert.rejects(() => loadJSON(`${baseUrl}/missing.json`), /404/);
  });
});

describe("parsePath", () => {
  it("parses dot notation", () => {
    assert.deepEqual(parsePath("users.0.name"), ["users", "0", "name"]);
  });

  it("parses bracket index notation", () => {
    assert.deepEqual(parsePath("users[0]"), ["users", "0"]);
    assert.deepEqual(parsePath("users[0].name"), ["users", "0", "name"]);
  });

  it("parses chained brackets", () => {
    assert.deepEqual(parsePath("a[0][1]"), ["a", "0", "1"]);
  });

  it("parses quoted keys with special chars", () => {
    assert.deepEqual(parsePath('obj["a.b"]'), ["obj", "a.b"]);
    assert.deepEqual(parsePath("obj['c d']"), ["obj", "c d"]);
  });

  it("returns empty array for empty path", () => {
    assert.deepEqual(parsePath(""), []);
  });

  it("throws for an unclosed bracket", () => {
    assert.throws(() => parsePath("users[0"), /unclosed/i);
  });
});

describe("navigate", () => {
  it("returns the root when path is empty", () => {
    assert.deepEqual(navigate(data, ""), data);
  });

  it("navigates into object keys", () => {
    assert.equal(navigate(data, "name"), "alice");
    assert.deepEqual(navigate(data, "address"), { city: "tokyo", zip: "100-0001" });
  });

  it("navigates into array indices", () => {
    assert.equal(navigate(data, "tags.0"), "x");
    assert.equal(navigate(data, "tags.2"), "z");
  });

  it("navigates with bracket index notation", () => {
    assert.equal(navigate(data, "tags[1]"), "y");
    assert.equal(navigate(data, "address[\"city\"]"), "tokyo");
  });

  it("navigates nested paths", () => {
    assert.equal(navigate(data, "address.city"), "tokyo");
  });

  it("throws when descending into a primitive", () => {
    assert.throws(() => navigate(data, "name.first"), /Cannot access/);
  });

  it("throws for a missing key", () => {
    assert.throws(() => navigate(data, "missing"), /not found/);
  });

  it("throws for an out-of-bounds index", () => {
    assert.throws(() => navigate(data, "tags.9"), /out of bounds/);
  });

  it("throws for a non-numeric array index", () => {
    assert.throws(() => navigate(data, "tags.abc"), /array index/);
  });
});

describe("entries", () => {
  it("lists object keys with type labels", () => {
    const list = entries(data);
    const byKey = Object.fromEntries(list.map((e) => [e.key, e.type]));
    assert.equal(byKey["name"], "string");
    assert.equal(byKey["age"], "number");
    assert.equal(byKey["active"], "boolean");
    assert.equal(byKey["tags"], "array[3]");
    assert.equal(byKey["address"], "object");
    assert.equal(byKey["nothing"], "null");
  });

  it("lists array items with index keys", () => {
    const tags = data.tags as string[];
    const list = entries(tags);
    assert.deepEqual(list.map((e) => e.key), ["0", "1", "2"]);
    assert.deepEqual(list.map((e) => e.type), ["string", "string", "string"]);
  });

  it("wraps a scalar as a single (value) entry", () => {
    const list = entries("hello");
    assert.equal(list.length, 1);
    assert.equal(list[0]!.key, "(value)");
    assert.equal(list[0]!.type, "string");
  });

  it("wraps null as a single (value) entry", () => {
    const list = entries(null);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.key, "(value)");
    assert.equal(list[0]!.type, "null");
    assert.equal(list[0]!.preview, "null");
  });

  it("previews long strings with an ellipsis", () => {
    const long = "a".repeat(100);
    const list = entries(long);
    assert.ok(list[0]!.preview.includes("..."));
  });

  it("respects the maxLen option for string previews", () => {
    const long = "x".repeat(100);
    const list = entries(long, { maxLen: 10 });
    assert.ok(list[0]!.preview.includes("..."));
    assert.ok(list[0]!.preview.length < 20);
  });
});

describe("formatPreview", () => {
  it("quotes and escapes strings", () => {
    assert.equal(formatPreview("hi"), '"hi"');
  });

  it("truncates long strings to maxLen and appends ellipsis", () => {
    const out = formatPreview("a".repeat(50), 10);
    assert.ok(out.startsWith('"aaaaaaaaaa'));
    assert.ok(out.includes("..."));
  });

  it("renders number and boolean as-is", () => {
    assert.equal(formatPreview(42), "42");
    assert.equal(formatPreview(true), "true");
  });

  it("summarizes arrays and objects", () => {
    assert.equal(formatPreview([1, 2, 3]), "array[3]");
    assert.equal(formatPreview({ a: 1, b: 2 }), "object{2}");
  });
});

describe("search", () => {
  const tree: JsonValue = {
    users: [
      { name: "alice", role: "admin" },
      { name: "bob", role: "user" },
    ],
    meta: { total: 2, label: "user-list" },
  };

  const paths = (q: string) => search(tree, q).map((r) => r.path);

  it("finds nodes by key name", () => {
    assert.deepEqual(paths("name"), ["users[0].name", "users[1].name"]);
    assert.deepEqual(paths("total"), ["meta.total"]);
  });

  it("finds nodes by string value", () => {
    assert.deepEqual(paths("alice"), ["users[0].name"]);
  });

  it("finds nodes by substring across keys and values", () => {
    const r = paths("user");
    assert.ok(r.includes("users[1].role"));
    assert.ok(r.includes("meta.label"));
  });

  it("matches scalar values of any type (number)", () => {
    assert.deepEqual(paths("2"), ["meta.total"]);
  });

  it("is case-insensitive", () => {
    assert.deepEqual(paths("ALICE"), ["users[0].name"]);
  });

  it("reports the matched field and a preview", () => {
    const r = search(tree, "alice")[0]!;
    assert.equal(r.matched, "value");
    assert.equal(r.key, "name");
    assert.equal(r.type, "string");
    assert.equal(r.preview, '"alice"');
  });

  it("returns an empty array for no match", () => {
    assert.deepEqual(search(tree, "zzznomatch"), []);
  });
});
