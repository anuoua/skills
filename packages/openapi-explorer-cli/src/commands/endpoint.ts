import { loadSpec } from "../core/loader.ts";
import { getEndpoints, getPathParams } from "../core/queries.ts";
import { deepResolve } from "../core/resolve.ts";
import { fmtEndpoint } from "../formatters/endpoint.ts";
import type { FormattedEndpoint } from "../types.ts";

export async function cmdEndpoint(
  source: string,
  path: string,
  method: string,
  full = false,
): Promise<string> {
  const spec = await loadSpec(source);
  method = method.toLowerCase();
  const op = spec.paths[path]?.[method];
  if (!op) {
    const similar = getEndpoints(spec)
      .filter((e) => e.path.includes(path) || path.includes(e.path))
      .slice(0, 5);
    const hint = similar.length
      ? "\n\nDid you mean?\n" +
        similar.map((e) => `  ${e.method.toUpperCase()} ${e.path}`).join("\n")
      : "";
    throw new Error(`No ${method.toUpperCase()} ${path} found.${hint}`);
  }

  const paramNames = getPathParams(path);
  const mergedParams = [
    ...paramNames.map(
      (n) =>
        (op.parameters || []).find((p: any) => p.name === n) || {
          name: n,
          in: "path",
          required: true,
          description: `Path param: ${n}`,
          schema: { type: "string" },
        },
    ),
    ...(op.parameters || []).filter((p: any) => !paramNames.includes(p.name)),
  ];

  const ep: FormattedEndpoint = {
    path,
    method,
    summary: op.summary,
    description: op.description,
    operationId: op.operationId,
    tags: op.tags || [],
    deprecated: op.deprecated || false,
    parameters: full
      ? mergedParams.map((p: any) => ({
          ...p,
          schema: p.schema ? deepResolve(p.schema, spec) : p.schema,
        }))
      : mergedParams,
    requestBody: op.requestBody
      ? {
          description: op.requestBody.description,
          required: op.requestBody.required,
          content: Object.fromEntries(
            Object.entries(op.requestBody.content).map(
              ([ct, mt]: [string, any]) => [
                ct,
                {
                  schema:
                    full && mt.schema
                      ? deepResolve(mt.schema, spec)
                      : mt.schema,
                },
              ],
            ),
          ),
        }
      : undefined,
    responses: op.responses
      ? Object.fromEntries(
          Object.entries(op.responses).map(([code, resp]: [string, any]) => [
            code,
            {
              description: resp.description,
              content: resp.content
                ? Object.fromEntries(
                    Object.entries(resp.content).map(
                      ([ct, mt]: [string, any]) => [
                        ct,
                        {
                          schema:
                            full && mt.schema
                              ? deepResolve(mt.schema, spec)
                              : mt.schema,
                        },
                      ],
                    ),
                  )
                : undefined,
            },
          ]),
        )
      : undefined,
    security: op.security,
  };

  return fmtEndpoint(ep);
}
