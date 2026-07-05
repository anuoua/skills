import type { FormattedEndpoint } from "../types.ts";
import { fmtSchema } from "./schema.ts";

export function fmtEndpoint(ep: FormattedEndpoint): string {
  const lines: string[] = [`# ${ep.method.toUpperCase()} ${ep.path}`];
  if (ep.deprecated) lines.push("", "DEPRECATED");
  if (ep.summary) lines.push("", ep.summary);
  if (ep.description) lines.push("", ep.description);
  if (ep.operationId) lines.push("", `Operation ID: \`${ep.operationId}\``);
  if (ep.tags?.length)
    lines.push("", `Tags: ${ep.tags.map((t) => `\`${t}\``).join(", ")}`);

  if (ep.parameters?.length) {
    lines.push(
      "",
      "## Parameters",
      "",
      "| Name | In | Type | Required | Description |",
      "|------|----|------|----------|-------------|",
    );
    for (const p of ep.parameters) {
      lines.push(
        `| \`${p.name}\` | ${p.in} | ${p.schema?.type || p.type || "string"} | ${p.required ? "Yes" : "No"} | ${p.description || ""} |`,
      );
    }
  }

  if (ep.requestBody) {
    lines.push("", "## Request Body");
    if (ep.requestBody.required) lines.push("> Required");
    if (ep.requestBody.description) lines.push("", ep.requestBody.description);
    for (const [ct, mt] of Object.entries(ep.requestBody.content || {})) {
      lines.push(
        "",
        `${ct}:`,
        "```",
        fmtSchema((mt as any).schema || {}),
        "```",
      );
    }
  }

  if (ep.responses) {
    lines.push("", "## Responses");
    for (const [code, resp] of Object.entries(ep.responses)) {
      const r = resp as any;
      lines.push("", `### ${code}`, r.description);
      if (r.content) {
        for (const [ct, mt] of Object.entries(r.content)) {
          lines.push(
            "",
            `${ct}:`,
            "```",
            fmtSchema((mt as any).schema || {}),
            "```",
          );
        }
      }
    }
  }

  if (ep.security?.length) {
    lines.push("", "## Security");
    for (const sec of ep.security) {
      for (const [scheme, scopes] of Object.entries(sec)) {
        lines.push(
          `- \`${scheme}\`${Array.isArray(scopes) && scopes.length ? ` [${scopes.join(", ")}]` : ""}`,
        );
      }
    }
  }

  return lines.join("\n");
}
