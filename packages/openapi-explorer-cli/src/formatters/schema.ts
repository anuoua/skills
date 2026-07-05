export function fmtSchema(schema: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (!schema || typeof schema !== "object") return `${pad}${String(schema)}`;

  const s = schema as Record<string, unknown>;

  if (s.$ref && typeof s.$ref === "string") {
    return `${pad}$ref: "${(s.$ref as string).split("/").pop()}"`;
  }

  if (s.enum && Array.isArray(s.enum)) {
    return `${pad}enum: [${s.enum.map((v) => JSON.stringify(v)).join(", ")}]`;
  }

  for (const kw of ["oneOf", "anyOf", "allOf"] as const) {
    if (s[kw] && Array.isArray(s[kw])) {
      const lines = [`${pad}${kw}:`];
      for (let i = 0; i < s[kw].length; i++) {
        if (i > 0) lines.push(`${pad}  ---`);
        lines.push(fmtSchema(s[kw][i], indent + 1));
      }
      return lines.join("\n");
    }
  }

  const allLines: string[] = [];

  if (s.description && typeof s.description === "string") {
    allLines.push(`${pad}// ${s.description}`);
  }

  allLines.push(
    `${pad}type: ${s.type || "any"}${s.format ? `<${s.format}>` : ""}${s.nullable ? " | null" : ""}`,
  );

  if (s.properties && typeof s.properties === "object") {
    const req = new Set<string>(Array.isArray(s.required) ? s.required : []);
    for (const [pn, ps] of Object.entries(
      s.properties as Record<string, unknown>,
    )) {
      allLines.push(`${pad}${pn}${req.has(pn) ? " (required)" : ""}:`);
      allLines.push(fmtSchema(ps, indent + 1));
    }
  }

  if (s.items) {
    allLines.push(`${pad}items:`);
    allLines.push(fmtSchema(s.items, indent + 1));
  }

  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    allLines.push(`${pad}additionalProperties:`);
    allLines.push(fmtSchema(s.additionalProperties, indent + 1));
  }

  if (s.example !== undefined)
    allLines.push(`${pad}example: ${JSON.stringify(s.example)}`);
  if (s.default !== undefined)
    allLines.push(`${pad}default: ${JSON.stringify(s.default)}`);
  for (const k of ["minLength", "maxLength", "minimum", "maximum"] as const) {
    if (s[k] !== undefined) allLines.push(`${pad}${k}: ${s[k] as number}`);
  }
  if (s.pattern) allLines.push(`${pad}pattern: ${s.pattern as string}`);

  return allLines.join("\n");
}
