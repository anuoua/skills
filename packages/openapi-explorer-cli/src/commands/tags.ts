import { loadSpec } from "../core/loader.ts";
import { getTags } from "../core/queries.ts";

export async function cmdTags(source: string): Promise<string> {
  const spec = await loadSpec(source);
  const tags = getTags(spec);
  if (!tags.length) return "No tags found.";
  const lines = ["# Tags", "", "| Tag | Endpoints |", "|-----|-----------|"];
  for (const t of tags) lines.push(`| \`${t.name}\` | ${t.count} |`);
  return lines.join("\n");
}
