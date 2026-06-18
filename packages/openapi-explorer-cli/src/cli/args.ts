export function parseArgs(argv: string[]): {
  command: string;
  source: string;
  flags: Record<string, string | boolean | number>;
  positional: string[];
} {
  const args = argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    return { command: "help", source: "", flags: {}, positional: [] };
  }

  const command = args[0] ?? "";
  const source = args[1] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean | number> = {};

  let i = 2;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "full") {
        flags[key] = true;
        i++;
      } else if (key === "tag" || key === "limit" || key === "offset") {
        flags[key] = args[i + 1] ?? "";
        i += 2;
      } else {
        flags[key] = args[i + 1] ?? true;
        i += 2;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { command, source, flags, positional };
}

export function printHelp(): string {
  return `Usage: openapi-explorer <command> <source> [args...]

source can be a URL (https://...) or a local file path.

Commands:
  info <source>                          API overview
  tags <source>                          List tag groups
  paths <source> [--tag <t>] [--limit N] [--offset N]   List endpoints
  endpoint <source> <path> <method> [--full]             Endpoint detail
  schemas <source> [--limit N] [--offset N]              List schemas
  schema <source> <schema_name>                           Schema detail
  search <source> <query>                                 Full-text search

Examples:
  openapi-explorer info https://petstore.swagger.io/v2/swagger.json
  openapi-explorer endpoint ./spec.json /pets/{petId} get --full
  openapi-explorer paths ./spec.json --tag pets`;
}
