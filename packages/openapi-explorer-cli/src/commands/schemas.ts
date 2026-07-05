import { loadSpec } from "../core/loader.ts";
import { getSchemas } from "../core/queries.ts";

export async function cmdSchemas(
  source: string,
  limit = 50,
  offset = 0,
): Promise<string> {
  const spec = await loadSpec(source);
  const all = getSchemas(spec);
  const paginated = all.slice(offset, offset + limit);

  if (!paginated.length) {
    return all.length === 0
      ? "No schemas defined."
      : `No more schemas (offset ${offset} of ${all.length}).`;
  }

  const hasMore = all.length > offset + paginated.length;
  const lines: string[] = [
    "# Component Schemas",
    "",
    `${all.length} total (showing ${paginated.length})`,
    "",
    "| Name | Type | Properties | Description |",
    "|------|------|------------|-------------|",
  ];

  for (const s of paginated) {
    lines.push(
      `| \`${s.name}\` | ${s.type} | ${s.properties} | ${(s.description || "").slice(0, 80)} |`,
    );
  }

  if (hasMore) {
    lines.push(
      `\n> Showing ${paginated.length} of ${all.length}. Use --offset=${offset + paginated.length} to see more.`,
    );
  }

  lines.push(
    "\nUse `openapi-explorer schema <source> <schema_name>` for details.",
  );
  return lines.join("\n");
}
