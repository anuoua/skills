import { loadSpec } from "../core/loader.ts";
import { getSchemas, getSchemaDetail } from "../core/queries.ts";
import { fmtSchema } from "../formatters/schema.ts";

export async function cmdSchema(
  source: string,
  schemaName: string,
): Promise<string> {
  const spec = await loadSpec(source);
  const schema = getSchemaDetail(spec, schemaName);
  if (!schema) {
    const suggestions = getSchemas(spec)
      .slice(0, 10)
      .map((s) => s.name);
    throw new Error(
      `Schema '${schemaName}' not found.\n\nAvailable:\n${suggestions.map((s) => `  - ${s}`).join("\n")}`,
    );
  }
  return [`# Schema: ${schemaName}`, "", "```", fmtSchema(schema), "```"].join(
    "\n",
  );
}
