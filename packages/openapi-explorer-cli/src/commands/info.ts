import type { OpenAPISpec } from "../types.ts";
import { loadSpec, getServerUrl } from "../core/loader.ts";
import { getEndpoints, getSchemas, getTags } from "../core/queries.ts";

export async function cmdInfo(source: string): Promise<string> {
  const spec = await loadSpec(source);
  const eps = getEndpoints(spec);
  const schemas = getSchemas(spec);
  const tags = getTags(spec);
  const url = getServerUrl(spec);
  const sv = spec.openapi || spec.swagger || "unknown";

  const lines: string[] = [
    `# ${spec.info.title}`,
    "",
    `Version: ${spec.info.version}`,
    `OpenAPI Version: ${sv}`,
    `Server: \`${url || "Not specified"}\``,
    "",
    spec.info.description || "",
    "",
    "## Summary",
    `- Endpoints: ${eps.length}`,
    `- Schemas: ${schemas.length}`,
    `- Tags: ${tags.length}`,
  ];

  if (spec.info.contact) {
    lines.push("", "## Contact");
    for (const k of ["name", "email", "url"] as const) {
      const val = spec.info.contact[k];
      if (val)
        lines.push(`- ${k.charAt(0).toUpperCase() + k.slice(1)}: ${val}`);
    }
  }

  if (spec.info.license) {
    lines.push("", "## License");
    lines.push(`- Name: ${spec.info.license.name}`);
    if (spec.info.license.url) lines.push(`- URL: ${spec.info.license.url}`);
  }

  return lines.join("\n");
}
