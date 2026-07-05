import type {
  OpenAPISpec,
  EndpointSummary,
  SchemaSummary,
  SearchResult,
} from "../types.ts";

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
] as const;
const METHOD_PRIORITY: Record<string, number> = {
  get: 0,
  post: 1,
  put: 2,
  patch: 3,
  delete: 4,
  options: 5,
  head: 6,
};

export function getEndpoints(
  spec: OpenAPISpec,
  tag?: string,
): EndpointSummary[] {
  const eps: EndpointSummary[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      if (tag && (!op.tags || !op.tags.includes(tag))) continue;
      eps.push({
        path,
        method,
        summary:
          op.summary || op.operationId || `${method.toUpperCase()} ${path}`,
        operationId: op.operationId,
        tags: op.tags || [],
        deprecated: op.deprecated || false,
      });
    }
  }
  eps.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return (
      (METHOD_PRIORITY[a.method] ?? 99) - (METHOD_PRIORITY[b.method] ?? 99)
    );
  });
  return eps;
}

export function getTags(spec: OpenAPISpec): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const pathItem of Object.values(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op?.tags) continue;
      for (const tag of op.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSchemas(spec: OpenAPISpec): SchemaSummary[] {
  const schemas = spec.components?.schemas || spec.definitions || {};
  return Object.entries(schemas)
    .map(([name, s]) => ({
      name,
      type: (s as any).type || "object",
      description: (s as any).description || (s as any).title,
      properties: (s as any).properties
        ? Object.keys((s as any).properties).length
        : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSchemaDetail(spec: OpenAPISpec, name: string): unknown {
  return (spec.components?.schemas || spec.definitions || {})[name] || null;
}

export function getPathParams(path: string): string[] {
  const m = path.match(/\{(\w+)\}/g);
  return m ? m.map((s) => s.slice(1, -1)) : [];
}

export function searchSpec(spec: OpenAPISpec, query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lower = query.toLowerCase();

  for (const [path, pi] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = pi[method];
      if (!op) continue;
      const text = [
        path,
        method,
        op.summary,
        op.operationId,
        op.description,
        ...(op.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (text.includes(lower)) {
        results.push({
          type: "endpoint",
          path,
          method,
          match: `${method.toUpperCase()} ${path}`,
          summary: op.summary || op.operationId,
        });
      }
    }
  }

  const schemas = spec.components?.schemas || spec.definitions || {};
  for (const [name, s] of Object.entries(schemas)) {
    const sAny = s as any;
    if (
      [name, sAny.description, sAny.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(lower)
    ) {
      results.push({
        type: "schema",
        schemaName: name,
        match: `Schema: ${name}`,
        summary: sAny.description,
      });
    }
    if (sAny.properties) {
      for (const [pn, ps] of Object.entries(sAny.properties)) {
        const psAny = ps as any;
        if (
          [pn, psAny.description]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(lower)
        ) {
          results.push({
            type: "property",
            schemaName: name,
            propertyName: pn,
            match: `Schema ${name} > ${pn}`,
            summary: psAny.description,
          });
        }
      }
    }
  }

  return results;
}
