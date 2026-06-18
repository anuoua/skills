import { describe, it, before } from "node:test";
import assert from "node:assert";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, unlink } from "node:fs/promises";

import type { OpenAPISpec, FormattedEndpoint } from "../src/types.ts";
import { loadSpec, getServerUrl } from "../src/core/loader.ts";
import {
  getEndpoints,
  getTags,
  getSchemas,
  getSchemaDetail,
  getPathParams,
  searchSpec,
} from "../src/core/queries.ts";
import { resolveRef, deepResolve } from "../src/core/resolve.ts";
import { fmtSchema } from "../src/formatters/schema.ts";
import { fmtEndpoint } from "../src/formatters/endpoint.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "openapi.json");
let spec: OpenAPISpec;

describe("core/loader", () => {
  before(async () => {
    spec = await loadSpec(SPEC_PATH);
  });

  describe("loadSpec", () => {
    it("should load a valid OpenAPI spec from file", async () => {
      const s = await loadSpec(SPEC_PATH);
      assert.equal(s.info.title, "opencode");
      assert.equal(s.info.version, "1.0.0");
      assert.equal(s.openapi, "3.1.0");
    });

    it("should throw for non-existent file", async () => {
      await assert.rejects(
        () => loadSpec("/nonexistent/path.json"),
        /ENOENT|not found/,
      );
    });

    it("should throw for invalid JSON", async () => {
      const tmp = "/tmp/invalid-spec.json";
      await writeFile(tmp, "not json");
      await assert.rejects(() => loadSpec(tmp), /JSON|parse|Unexpected/);
      await unlink(tmp);
    });

    it("should throw for non-OpenAPI JSON", async () => {
      const tmp = "/tmp/not-openapi.json";
      await writeFile(tmp, JSON.stringify({ name: "foo" }));
      await assert.rejects(() => loadSpec(tmp), /valid OpenAPI|Swagger/);
      await unlink(tmp);
    });

    it("should throw for spec missing info", async () => {
      const tmp = "/tmp/no-info.json";
      await writeFile(tmp, JSON.stringify({ openapi: "3.1.0", paths: {} }));
      await assert.rejects(() => loadSpec(tmp), /missing 'info'/);
      await unlink(tmp);
    });

    it("should set defaults for missing title/version", async () => {
      const tmp = "/tmp/minimal-spec.json";
      await writeFile(
        tmp,
        JSON.stringify({ openapi: "3.1.0", info: {}, paths: {} }),
      );
      const s = await loadSpec(tmp);
      assert.equal(s.info.title, "Untitled API");
      assert.equal(s.info.version, "0.0.0");
      await unlink(tmp);
    });
  });

  describe("getServerUrl", () => {
    it("should extract OpenAPI v3 server URL", () => {
      const s = {
        ...spec,
        servers: [{ url: "https://api.example.com/v1" }],
      } as OpenAPISpec;
      assert.equal(getServerUrl(s), "https://api.example.com/v1");
    });

    it("should strip trailing slash from server URL", () => {
      const s = {
        ...spec,
        servers: [{ url: "https://api.example.com/" }],
      } as OpenAPISpec;
      assert.equal(getServerUrl(s), "https://api.example.com");
    });

    it("should construct URL from Swagger v2 fields", () => {
      const s = {
        ...spec,
        servers: undefined,
        host: "api.example.com",
        basePath: "/v2",
        schemes: ["https"],
      } as unknown as OpenAPISpec;
      assert.equal(getServerUrl(s), "https://api.example.com/v2");
    });

    it("should default to https for Swagger v2 without schemes", () => {
      const s = {
        ...spec,
        servers: undefined,
        host: "api.example.com",
        basePath: "/api",
        schemes: undefined,
      } as unknown as OpenAPISpec;
      assert.equal(getServerUrl(s), "https://api.example.com/api");
    });

    it("should return empty string when no server info", () => {
      const s = {
        ...spec,
        servers: undefined,
        host: undefined,
      } as unknown as OpenAPISpec;
      assert.equal(getServerUrl(s), "");
    });
  });
});

describe("core/queries", () => {
  before(async () => {
    spec = await loadSpec(SPEC_PATH);
  });

  describe("getEndpoints", () => {
    it("should return all 165 endpoints", () => {
      assert.equal(getEndpoints(spec).length, 165);
    });

    it("should filter endpoints by tag", () => {
      const eps = getEndpoints(spec, "global");
      assert.ok(eps.length > 0);
      for (const ep of eps) assert.ok(ep.tags.includes("global"));
      assert.equal(eps.length, 6);
    });

    it("should return empty array for unknown tag", () => {
      assert.deepEqual(getEndpoints(spec, "nonexistent-tag"), []);
    });

    it("should sort by path then method priority", () => {
      const eps = getEndpoints(spec);
      for (let i = 1; i < eps.length; i++) {
        const prev = eps[i - 1]!;
        const curr = eps[i]!;
        if (prev.path === curr.path) {
          const order = [
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "options",
            "head",
          ];
          assert.ok(order.indexOf(prev.method) <= order.indexOf(curr.method));
        } else {
          assert.ok(prev.path.localeCompare(curr.path) <= 0);
        }
      }
    });

    it("should include global.health endpoint", () => {
      const ep = getEndpoints(spec, "global").find(
        (e) => e.operationId === "global.health",
      );
      assert.ok(ep);
      assert.equal(ep?.method, "get");
      assert.equal(ep?.path, "/global/health");
    });

    it("should mark deprecated endpoints", () => {
      const eps = getEndpoints(spec);
      const deprecated = eps.filter((e) => e.deprecated);
      assert.ok(
        deprecated.length > 0,
        "Expected at least one deprecated endpoint",
      );
    });
  });

  describe("getTags", () => {
    it("should return 32 tags", () => {
      assert.equal(getTags(spec).length, 32);
    });

    it("should include global with 6 endpoints", () => {
      const t = getTags(spec).find((t) => t.name === "global");
      assert.ok(t);
      assert.equal(t?.count, 6);
    });

    it("should be sorted alphabetically", () => {
      const tags = getTags(spec);
      for (let i = 1; i < tags.length; i++) {
        assert.ok(tags[i - 1]!.name.localeCompare(tags[i]!.name) <= 0);
      }
    });
  });

  describe("getSchemas", () => {
    it("should return all 342 schemas", () => {
      assert.equal(getSchemas(spec).length, 342);
    });

    it("should include Config schema with 35 properties", () => {
      const s = getSchemas(spec).find((s) => s.name === "Config");
      assert.ok(s);
      assert.equal(s?.type, "object");
      assert.equal(s?.properties, 35);
    });

    it("should include string-type schemas", () => {
      const s = getSchemas(spec).find((s) => s.name === "LayoutConfig");
      assert.ok(s);
      assert.equal(s?.type, "string");
    });

    it("should include array-type schemas", () => {
      const s = getSchemas(spec).find((s) => s.name === "ToolList");
      assert.ok(s);
      assert.equal(s?.type, "array");
    });

    it("should be sorted alphabetically", () => {
      const schemas = getSchemas(spec);
      for (let i = 1; i < schemas.length; i++) {
        assert.ok(schemas[i - 1]!.name.localeCompare(schemas[i]!.name) <= 0);
      }
    });
  });

  describe("getSchemaDetail", () => {
    it("should return details for known schema", () => {
      const s = getSchemaDetail(spec, "Config") as Record<string, unknown>;
      assert.equal(s?.type, "object");
      assert.ok(s?.properties);
    });

    it("should return null for unknown schema", () => {
      assert.equal(getSchemaDetail(spec, "NonExistentSchema"), null);
    });
  });

  describe("getPathParams", () => {
    it("should extract single path param", () => {
      assert.deepEqual(getPathParams("/auth/{providerID}"), ["providerID"]);
    });

    it("should return empty for path without params", () => {
      assert.deepEqual(getPathParams("/global/health"), []);
    });

    it("should extract multiple params", () => {
      assert.deepEqual(getPathParams("/users/{uid}/posts/{pid}"), [
        "uid",
        "pid",
      ]);
    });
  });

  describe("searchSpec", () => {
    it("should find endpoints by operationId", () => {
      const r = searchSpec(spec, "global.health");
      assert.ok(
        r.some(
          (x) =>
            x.type === "endpoint" &&
            x.path === "/global/health" &&
            x.method === "get",
        ),
      );
    });

    it("should find endpoints by summary", () => {
      const r = searchSpec(spec, "Get health");
      assert.ok(
        r.some((x) => x.type === "endpoint" && x.path === "/global/health"),
      );
    });

    it("should find endpoints by path", () => {
      const r = searchSpec(spec, "/global/health");
      assert.ok(
        r.some((x) => x.type === "endpoint" && x.path === "/global/health"),
      );
    });

    it("should find schemas by name", () => {
      const r = searchSpec(spec, "Config");
      assert.ok(
        r.some((x) => x.type === "schema" && x.schemaName === "Config"),
      );
    });

    it("should find properties by name", () => {
      const r = searchSpec(spec, "sessionID");
      assert.ok(
        r.some((x) => x.type === "property" && x.propertyName === "sessionID"),
      );
    });

    it("should be case-insensitive", () => {
      assert.equal(
        searchSpec(spec, "health").length,
        searchSpec(spec, "HEALTH").length,
      );
    });

    it("should return empty for no match", () => {
      assert.deepEqual(searchSpec(spec, "xyznonexistent12345"), []);
    });
  });

  describe("cross-field consistency", () => {
    it("tag endpoints sum >= total (due to multi-tag)", () => {
      const total = getEndpoints(spec).length;
      const tagSum = getTags(spec).reduce((s, t) => s + t.count, 0);
      assert.ok(tagSum >= total);
    });

    it("every listed schema has a detail", () => {
      for (const s of getSchemas(spec)) {
        assert.ok(
          getSchemaDetail(spec, s.name),
          `Missing detail for "${s.name}"`,
        );
      }
    });

    it("endpoints found via tag are also searchable", () => {
      for (const ep of getEndpoints(spec, "experimental")) {
        const r = searchSpec(spec, ep.operationId || ep.summary);
        assert.ok(r.length > 0);
      }
    });
  });
});

describe("core/resolve", () => {
  before(async () => {
    spec = await loadSpec(SPEC_PATH);
  });

  describe("resolveRef", () => {
    it("should resolve valid $ref to schema", () => {
      const resolved = resolveRef(
        spec,
        "#/components/schemas/Config",
      ) as Record<string, unknown>;
      assert.ok(resolved);
      assert.ok(resolved?.properties);
    });

    it("should return null for invalid $ref path", () => {
      assert.equal(resolveRef(spec, "#/components/schemas/NonExistent"), null);
    });

    it("should return null for malformed $ref", () => {
      assert.equal(resolveRef(spec, "invalid-ref"), null);
    });
  });

  describe("deepResolve", () => {
    it("should resolve a simple $ref", () => {
      const resolved = deepResolve(
        { $ref: "#/components/schemas/Config" },
        spec,
      ) as Record<string, unknown>;
      assert.equal(resolved.type, "object");
      assert.ok(resolved.properties);
    });

    it("should deeply resolve nested $ref in properties", () => {
      const schema = deepResolve(
        {
          type: "object",
          properties: {
            config: { $ref: "#/components/schemas/Config" },
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/ToolList" },
            },
          },
        },
        spec,
      ) as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      assert.equal((props.config as Record<string, unknown>)?.type, "object");
      assert.equal((props.items as Record<string, unknown>)?.type, "array");
    });

    it("should resolve $ref in oneOf / anyOf / allOf", () => {
      const schema = deepResolve(
        {
          oneOf: [
            { $ref: "#/components/schemas/Config" },
            { $ref: "#/components/schemas/ToolList" },
          ],
        },
        spec,
      ) as Record<string, unknown>;
      assert.ok(Array.isArray(schema.oneOf));
      assert.equal(schema.oneOf?.length, 2);
    });

    it("should merge sibling properties with $ref", () => {
      const resolved = deepResolve(
        { $ref: "#/components/schemas/Config", description: "override" },
        spec,
      ) as Record<string, unknown>;
      assert.equal(resolved.description, "override");
      assert.ok(resolved.properties);
    });

    it("should handle circular references without infinite loop", () => {
      const schemas = spec.components?.schemas || {};
      const circularKey = Object.keys(schemas).find((k) =>
        JSON.stringify(schemas[k]).includes("#/components/schemas/" + k),
      );
      if (circularKey) {
        const resolved = deepResolve(
          { $ref: `#/components/schemas/${circularKey}` },
          spec,
        );
        assert.ok(resolved);
      }
    });

    it("should resolve deeply (3+ levels of nesting)", () => {
      const schema = deepResolve(
        {
          type: "object",
          properties: {
            deep: {
              type: "object",
              properties: { inner: { $ref: "#/components/schemas/Config" } },
            },
          },
        },
        spec,
      ) as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const deep = props.deep as Record<string, unknown>;
      const innerProps = deep.properties as Record<string, unknown>;
      assert.equal(
        (innerProps.inner as Record<string, unknown>)?.type,
        "object",
      );
    });

    it("should return input as-is for schema without $ref", () => {
      const resolved = deepResolve({ type: "string" }, spec) as Record<
        string,
        unknown
      >;
      assert.equal(resolved.type, "string");
    });

    it("should return unresolvable $ref as-is", () => {
      const resolved = deepResolve(
        { $ref: "#/components/schemas/NonExistent" },
        spec,
      );
      assert.deepEqual(resolved, { $ref: "#/components/schemas/NonExistent" });
    });
  });
});

describe("formatters/schema", () => {
  describe("fmtSchema", () => {
    it("should format simple type", () => {
      assert.equal(fmtSchema({ type: "string" }), "type: string");
    });

    it("should format type with format", () => {
      assert.equal(
        fmtSchema({ type: "string", format: "date-time" }),
        "type: string<date-time>",
      );
    });

    it("should format nullable type", () => {
      assert.equal(
        fmtSchema({ type: "string", nullable: true }),
        "type: string | null",
      );
    });

    it("should format enum", () => {
      assert.equal(
        fmtSchema({ type: "string", enum: ["a", "b", "c"] }),
        'enum: ["a", "b", "c"]',
      );
    });

    it("should format $ref", () => {
      assert.equal(
        fmtSchema({ $ref: "#/components/schemas/Config" }),
        '$ref: "Config"',
      );
    });

    it("should format properties with required marker", () => {
      const result = fmtSchema({
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, age: { type: "integer" } },
      });
      assert.match(result, /name \(required\):\n  type: string/);
      assert.match(result, /age:\n  type: integer/);
    });

    it("should format nested objects", () => {
      const result = fmtSchema({
        type: "object",
        properties: {
          nested: { type: "object", properties: { x: { type: "number" } } },
        },
      });
      assert.match(result, /nested:\n  type: object\n  x:\n    type: number/);
    });

    it("should format array items", () => {
      const result = fmtSchema({ type: "array", items: { type: "string" } });
      assert.equal(result, "type: array\nitems:\n  type: string");
    });

    it("should format anyOf with separators", () => {
      const result = fmtSchema({
        anyOf: [{ type: "string" }, { type: "integer" }],
      });
      assert.equal(result, "anyOf:\n  type: string\n  ---\n  type: integer");
    });

    it("should format oneOf with separators", () => {
      const result = fmtSchema({
        oneOf: [
          { $ref: "#/components/schemas/Foo" },
          { $ref: "#/components/schemas/Bar" },
        ],
      });
      assert.equal(result, 'oneOf:\n  $ref: "Foo"\n  ---\n  $ref: "Bar"');
    });

    it("should format description as comment", () => {
      const result = fmtSchema({ type: "string", description: "A name" });
      assert.equal(result, "// A name\ntype: string");
    });

    it("should format constraints", () => {
      const result = fmtSchema({
        type: "string",
        minLength: 1,
        maxLength: 100,
        pattern: "^[a-z]+$",
      });
      assert.match(result, /minLength: 1/);
      assert.match(result, /maxLength: 100/);
      assert.match(result, /pattern: \^\[a-z\]\+\$/);
    });

    it("should format example and default", () => {
      const result = fmtSchema({ type: "number", example: 42, default: 0 });
      assert.match(result, /example: 42/);
      assert.match(result, /default: 0/);
    });

    it("should format additionalProperties", () => {
      const result = fmtSchema({
        type: "object",
        additionalProperties: { type: "string" },
      });
      assert.match(result, /additionalProperties:\n  type: string/);
    });

    it("should handle null/undefined schema", () => {
      assert.equal(fmtSchema(null), "null");
      assert.equal(fmtSchema(undefined), "undefined");
    });

    it("should handle primitive schema", () => {
      assert.equal(fmtSchema("hello"), "hello");
    });

    it("should default to 'any' when no type", () => {
      assert.equal(fmtSchema({}), "type: any");
    });
  });
});

describe("formatters/endpoint", () => {
  describe("fmtEndpoint", () => {
    it("should render basic endpoint header", () => {
      const ep: FormattedEndpoint = {
        path: "/health",
        method: "get",
        tags: [],
        deprecated: false,
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /^# GET \/health/);
    });

    it("should mark deprecated endpoints", () => {
      const ep: FormattedEndpoint = {
        path: "/old",
        method: "delete",
        tags: [],
        deprecated: true,
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /DEPRECATED/);
    });

    it("should include summary, description, operationId, tags", () => {
      const ep: FormattedEndpoint = {
        path: "/users",
        method: "get",
        summary: "List users",
        description: "Returns a list of all users",
        operationId: "users.list",
        tags: ["users"],
        deprecated: false,
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /List users/);
      assert.match(result, /Returns a list of all users/);
      assert.match(result, /users\.list/);
      assert.match(result, /`users`/);
    });

    it("should render parameters table", () => {
      const ep: FormattedEndpoint = {
        path: "/users/{id}",
        method: "get",
        tags: [],
        deprecated: false,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer" },
          },
        ],
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /\| `id` | path | string | Yes |/);
      assert.match(result, /\| `limit` | query | integer | No |/);
    });

    it("should render request body", () => {
      const ep: FormattedEndpoint = {
        path: "/users",
        method: "post",
        tags: [],
        deprecated: false,
        requestBody: {
          required: true,
          description: "User data",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
              },
            },
          },
        },
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /## Request Body/);
      assert.match(result, /> Required/);
      assert.match(result, /User data/);
      assert.match(result, /type: object/);
    });

    it("should render responses", () => {
      const ep: FormattedEndpoint = {
        path: "/health",
        method: "get",
        tags: [],
        deprecated: false,
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "404": { description: "Not found" },
        },
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /## Responses/);
      assert.match(result, /### 200/);
      assert.match(result, /OK/);
      assert.match(result, /### 404/);
      assert.match(result, /Not found/);
    });

    it("should render security", () => {
      const ep: FormattedEndpoint = {
        path: "/admin",
        method: "get",
        tags: [],
        deprecated: false,
        security: [{ apiKey: [] }, { bearer: ["admin"] }],
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /## Security/);
      assert.match(result, /`apiKey`/);
      assert.match(result, /`bearer` \[admin\]/);
    });

    it("should render a full real endpoint from spec", async () => {
      const s = await loadSpec(SPEC_PATH);
      const op = s.paths["/global/health"]?.get;
      assert.ok(op);
      const ep: FormattedEndpoint = {
        path: "/global/health",
        method: "get",
        summary: op.summary,
        description: op.description,
        operationId: op.operationId,
        tags: op.tags || [],
        deprecated: op.deprecated || false,
        responses: Object.fromEntries(
          Object.entries(op.responses).map(([code, resp]: [string, any]) => [
            code,
            resp,
          ]),
        ),
      };
      const result = fmtEndpoint(ep);
      assert.match(result, /GET \/global\/health/);
      assert.match(result, /global\.health/);
      assert.match(result, /### 200/);
    });
  });
});

describe("error-handling: loadSpec", () => {
  it("should throw clear error for invalid JSON", async () => {
    const tmp = "/tmp/bad-json.json";
    await writeFile(tmp, "{bad}");
    await assert.rejects(() => loadSpec(tmp), /JSON|parse|Unexpected/);
    await unlink(tmp);
  });

  it("should throw clear error for non-OpenAPI JSON", async () => {
    const tmp = "/tmp/not-api.json";
    await writeFile(tmp, JSON.stringify({ random: "data" }));
    await assert.rejects(() => loadSpec(tmp), /valid OpenAPI|Swagger/);
    await unlink(tmp);
  });

  it("should throw clear error for missing info", async () => {
    const tmp = "/tmp/no-info.json";
    await writeFile(tmp, JSON.stringify({ openapi: "3.1.0", paths: {} }));
    await assert.rejects(() => loadSpec(tmp), /missing 'info'/);
    await unlink(tmp);
  });
});
