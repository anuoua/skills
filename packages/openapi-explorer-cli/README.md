# OpenAPI Explorer CLI

CLI tool for progressive exploration of OpenAPI/Swagger API documentation. Load a spec from URL or local file and inspect endpoints, schemas, tags — all in one command, no state, no server.

Part of the `admin-skills` monorepo.

## Quick Start

Requires Node.js >= 22.18 (TypeScript is run natively via Node's built-in
type-stripping — no compiler or loader needed).

```bash
# run without installing
npx @askills/openapi-explorer-cli info https://petstore.swagger.io/v2/swagger.json

# or install globally
npm install -g @askills/openapi-explorer-cli
openapi-explorer info https://petstore.swagger.io/v2/swagger.json
```

## Commands

| Command                                               | Description                                              |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `info <source>`                                       | API overview: title, version, endpoint/schema/tag counts |
| `tags <source>`                                       | List tag groups with endpoint counts                     |
| `paths <source> [--tag <t>] [--limit N] [--offset N]` | List endpoints, filtered by tag, with pagination         |
| `endpoint <source> <path> <method> [--full]`          | Endpoint detail. `--full` resolves all `$ref`            |
| `schemas <source> [--limit N] [--offset N]`           | List component schemas with pagination                   |
| `schema <source> <schema_name>`                       | Schema detail with properties, types, constraints        |
| `search <source> <query>`                             | Full-text search across endpoints, schemas, properties   |

`<source>` is a URL (`https://...`) or local file path — auto-detected.

## Progressive Exploration Workflow

```
1. info <source>               → overview of the API
2. tags <source>                → see available groups
3. paths <source> --tag users   → browse endpoints in a group
4. endpoint <source> <path> <method> --full  → drill into endpoint
5. schemas <source>             → see available data models
6. schema <source> <name>       → inspect a model
7. search <source> <query>      → find anything across the spec
```

## Examples

```bash
node src/main.ts info https://petstore.swagger.io/v2/swagger.json
node src/main.ts tags ./spec.json
node src/main.ts paths ./spec.json --tag pets --limit 10
node src/main.ts schemas ./spec.json --limit 5
node src/main.ts schema ./spec.json Config
node src/main.ts endpoint ./spec.json /pets/{petId} get --full
node src/main.ts search ./spec.json "payment"
```

## Development

Requires Node.js 22+ (native TypeScript). No build step needed.

```bash
pnpm install
pnpm test
pnpm start info <source>
```

The source is TypeScript at `src/`, organized by module:

```
src/
├── main.ts                  # Entry point
├── types.ts                 # Shared types
├── cli/args.ts              # Argument parsing
├── cli/dispatch.ts          # Command routing
├── commands/                # One file per command
├── core/loader.ts           # Spec loading (URL/file)
├── core/queries.ts          # Query functions
├── core/resolve.ts          # $ref resolution
└── formatters/              # Schema & endpoint formatting
```

## Compatibility

- OpenAPI v3.x, Swagger v2
- JSON format only (YAML not supported)
- Remote URLs and local file paths
- Node.js 22+ (native TypeScript support required)

## License

MIT
