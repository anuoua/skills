import { loadSpec } from "../core/loader.ts";
import { searchSpec } from "../core/queries.ts";

export async function cmdSearch(
  source: string,
  query: string,
): Promise<string> {
  const spec = await loadSpec(source);
  const results = searchSpec(spec, query);
  if (!results.length) return `No results for '${query}'.`;

  const lines: string[] = [
    `# Search Results for '${query}'`,
    "",
    `Found ${results.length} matches`,
    "",
  ];

  const eps = results.filter((r) => r.type === "endpoint");
  const schemas = results.filter((r) => r.type === "schema");
  const props = results.filter((r) => r.type === "property");

  if (eps.length) {
    lines.push(`## Endpoints (${eps.length})`);
    for (const e of eps)
      lines.push(
        `- ${e.method?.toUpperCase()} \`${e.path}\` - ${e.summary || ""}`,
      );
    lines.push("");
  }

  if (schemas.length) {
    lines.push(`## Schemas (${schemas.length})`);
    for (const s of schemas)
      lines.push(`- ${s.schemaName} - ${s.summary || ""}`);
    lines.push("");
  }

  if (props.length) {
    lines.push(`## Properties (${props.length})`);
    for (const p of props)
      lines.push(
        `- \`${p.schemaName}.${p.propertyName}\` - ${p.summary || ""}`,
      );
    lines.push("");
  }

  return lines.join("\n");
}
