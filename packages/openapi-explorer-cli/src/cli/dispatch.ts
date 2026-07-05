import { cmdInfo } from "../commands/info.ts";
import { cmdTags } from "../commands/tags.ts";
import { cmdPaths } from "../commands/paths.ts";
import { cmdEndpoint } from "../commands/endpoint.ts";
import { cmdSchemas } from "../commands/schemas.ts";
import { cmdSchema } from "../commands/schema.ts";
import { cmdSearch } from "../commands/search.ts";
import { parseArgs, printHelp } from "./args.ts";

export async function dispatch(argv: string[]): Promise<string> {
  const { command, source, flags, positional } = parseArgs(argv);

  switch (command) {
    case "help":
      return printHelp();

    case "info":
      if (!source) throw new Error("Usage: swagger.mjs info <source>");
      return await cmdInfo(source);

    case "tags":
      if (!source) throw new Error("Usage: swagger.mjs tags <source>");
      return await cmdTags(source);

    case "paths": {
      if (!source)
        throw new Error(
          "Usage: swagger.mjs paths <source> [--tag <t>] [--limit N] [--offset N]",
        );
      const tag = typeof flags.tag === "string" ? flags.tag : undefined;
      const limit =
        typeof flags.limit === "string" ? parseInt(flags.limit, 10) || 50 : 50;
      const offset =
        typeof flags.offset === "string" ? parseInt(flags.offset, 10) || 0 : 0;
      return await cmdPaths(source, tag, limit, offset);
    }

    case "endpoint":
    case "ep": {
      const path = positional[0] || flags.path;
      const method = positional[1] || flags.method;
      if (!source || !path || !method) {
        throw new Error(
          "Usage: swagger.mjs endpoint <source> <path> <method> [--full]",
        );
      }
      const full = flags.full === true;
      return await cmdEndpoint(source, path as string, method as string, full);
    }

    case "schemas": {
      if (!source)
        throw new Error(
          "Usage: swagger.mjs schemas <source> [--limit N] [--offset N]",
        );
      const slimit =
        typeof flags.limit === "string" ? parseInt(flags.limit, 10) || 50 : 50;
      const soffset =
        typeof flags.offset === "string" ? parseInt(flags.offset, 10) || 0 : 0;
      return await cmdSchemas(source, slimit, soffset);
    }

    case "schema": {
      const schemaName = positional[0] || flags.name;
      if (!source || !schemaName)
        throw new Error("Usage: swagger.mjs schema <source> <schema_name>");
      return await cmdSchema(source, schemaName as string);
    }

    case "search": {
      const query = positional[0] || flags.query;
      if (!source || !query)
        throw new Error("Usage: swagger.mjs search <source> <query>");
      return await cmdSearch(source, query as string);
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}
