# JSON Explorer CLI

CLI tool for progressive, layer-by-layer exploration of JSON files. Pass a file
and an optional dot-separated path to inspect keys, types, and previews — one
level at a time, no pager, no state.

Part of the `admin-skills` monorepo.

## Quick Start

Requires Node.js >= 22.18 (TypeScript is run natively via Node's built-in
type-stripping — no compiler or loader needed).

```bash
# run without installing
npx @askills/json-explorer-cli data.json

# or install globally
npm install -g @askills/json-explorer-cli
json-explorer data.json
```

## Usage

```
Usage: json-explorer <file> [path]

Explore a JSON file layer by layer.

Arguments:
  file                  Path to the JSON file
  path                  Dot-separated path to a nested value (optional)

Examples:
  json-explorer data.json
  json-explorer data.json users
  json-explorer data.json users.0
  json-explorer data.json users.0.name
```

Each invocation lists the children of the targeted node: the full key path, a
type label (`string`, `number`, `array[N]`, `object`, …), and a short preview
for scalar values. Drill deeper by appending the next key to the path.

## Development

No build step needed for development — Node runs the TypeScript source directly.

```bash
pnpm install
pnpm test
pnpm start data.json
```

## License

MIT
