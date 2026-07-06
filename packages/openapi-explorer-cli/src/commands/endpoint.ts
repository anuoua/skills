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
  const opParams: any[] = op.parameters || [];
  // Swagger 2.0 models the request body as a parameter with in:"body" + schema,
  // separate from the path/query/header parameters.
  const bodyParam = opParams.find((p: any) => p.in === "body");
  const nonBodyParams = opParams.filter((p: any) => p.in !== "body");

  const mergedParams = [
    ...paramNames.map(
      (n) =>
        nonBodyParams.find((p: any) => p.name === n) || {
          name: n,
          in: "path",
          required: true,
          description: `Path param: ${n}`,
          schema: { type: "string" },
        },
    ),
    ...nonBodyParams.filter((p: any) => !paramNames.includes(p.name)),
  ];

  // Resolve $refs only under --full; otherwise leave schemas (with $ref) as-is.
  const resolve = (schema: any): any =>
    full && schema ? deepResolve(schema, spec) : schema;

  // Request body: OpenAPI 3 requestBody wins; otherwise build one from a
  // Swagger 2.0 body parameter so its schema renders in the Request Body
  // section (instead of "object" in the parameters table).
  let requestBody: any;
  if (op.requestBody) {
    requestBody = {
      description: op.requestBody.description,
      required: op.requestBody.required,
      content: Object.fromEntries(
        Object.entries(op.requestBody.content || {}).map(
          ([ct, mt]: [string, any]) => [ct, { schema: resolve(mt.schema) }],
        ),
      ),
    };
  } else if (bodyParam) {
    const ct =
      (op.consumes || spec.consumes || ["application/json"])[0] ||
      "application/json";
    requestBody = {
      description: bodyParam.description,
      required: bodyParam.required,
      content: { [ct]: { schema: resolve(bodyParam.schema) } },
    };
  }

  // Responses: OpenAPI 3 uses response.content; Swagger 2.0 uses a bare
  // response.schema + the operation's/root produces list.
  const produces = op.produces || spec.produces || ["application/json"];
  let responses: any;
  if (op.responses) {
    responses = Object.fromEntries(
      Object.entries(op.responses).map(([code, resp]: [string, any]) => {
        let content: any;
        if (resp.content) {
          content = Object.fromEntries(
            Object.entries(resp.content).map(([ct, mt]: [string, any]) => [
              ct,
              { schema: resolve(mt.schema) },
            ]),
          );
        } else if (resp.schema) {
          const ct = produces[0] || "application/json";
          content = { [ct]: { schema: resolve(resp.schema) } };
        }
        return [code, { description: resp.description, content }];
      }),
    );
  }

  const ep: FormattedEndpoint = {
    path,
    method,
    summary: op.summary,
    description: op.description,
    operationId: op.operationId,
    tags: op.tags || [],
    deprecated: op.deprecated || false,
    parameters: mergedParams.map((p: any) => ({
      ...p,
      schema: resolve(p.schema),
    })),
    requestBody,
    responses,
    security: op.security,
  };

  return fmtEndpoint(ep);
}
