import { loadSpec } from "../core/loader.ts";
import { getEndpoints } from "../core/queries.ts";

export async function cmdPaths(
  source: string,
  tag?: string,
  limit = 50,
  offset = 0,
): Promise<string> {
  const spec = await loadSpec(source);
  const all = getEndpoints(spec, tag);
  const paginated = all.slice(offset, offset + limit);

  if (!paginated.length) {
    return all.length === 0
      ? "No endpoints found."
      : `No more endpoints (offset ${offset} of ${all.length}).`;
  }

  const hasMore = all.length > offset + paginated.length;
  const lines: string[] = ["# Endpoints"];
  if (tag) lines.push(`\nFiltered by tag: \`${tag}\``);
  lines.push(`\n${all.length} total (showing ${paginated.length})`, "");

  for (const ep of paginated) {
    lines.push(
      `### \`${ep.method.toUpperCase()}\` ${ep.path}${ep.deprecated ? " ~~(deprecated)~~" : ""}`,
    );
    if (ep.summary) lines.push(ep.summary);
    if (ep.operationId) lines.push(`- Operation ID: \`${ep.operationId}\``);
    if (ep.tags.length)
      lines.push(`- Tags: ${ep.tags.map((t) => `\`${t}\``).join(", ")}`);
    lines.push("");
  }

  if (hasMore) {
    lines.push(
      `> Showing ${paginated.length} of ${all.length}. Use --offset=${offset + paginated.length} to see more.`,
    );
  }

  return lines.join("\n");
}
