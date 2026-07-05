import type { OpenAPISpec } from "../types.ts";

export function resolveRef(spec: OpenAPISpec, ref: string): unknown {
  const parts = ref.replace(/^#\//, "").split("/");
  let cur: unknown = spec as unknown as Record<string, unknown>;
  for (const p of parts) {
    if (
      cur &&
      typeof cur === "object" &&
      p in (cur as Record<string, unknown>)
    ) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return cur;
}

export function deepResolve(
  schema: unknown,
  spec: OpenAPISpec,
  visited = new Set<string>(),
): unknown {
  if (!schema || typeof schema !== "object") return schema;

  const obj = schema as Record<string, unknown>;

  if (obj.$ref && typeof obj.$ref === "string") {
    if (visited.has(obj.$ref))
      return { $ref: obj.$ref, description: `(circular: ${obj.$ref})` };
    visited.add(obj.$ref);
    const resolved = resolveRef(spec, obj.$ref);
    if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
      const base = deepResolve(resolved, spec, new Set(visited)) as Record<
        string,
        unknown
      >;
      const merged = { ...base };
      for (const k of Object.keys(obj)) if (k !== "$ref") merged[k] = obj[k];
      return merged;
    }
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "properties" && v && typeof v === "object") {
      const props: Record<string, unknown> = {};
      for (const [pn, ps] of Object.entries(v as Record<string, unknown>)) {
        props[pn] = deepResolve(ps, spec, new Set(visited));
      }
      result[k] = props;
    } else if (
      (k === "items" || k === "additionalProperties") &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      result[k] = deepResolve(v, spec, new Set(visited));
    } else if (["oneOf", "anyOf", "allOf"].includes(k) && Array.isArray(v)) {
      result[k] = (v as unknown[]).map((s) =>
        deepResolve(s, spec, new Set(visited)),
      );
    } else {
      result[k] = v;
    }
  }
  return result;
}
