# askills

A monorepo of CLI tools and agent skills for orchestrating and equiping LLM
agents. Built as a pnpm workspace; packages run TypeScript natively on
Node.js ≥ 22.18 (no build step), released via changesets.

## Packages

| Package | Binary | What it does |
|---------|--------|--------------|
| [`@askills/agent-chat-cli`](packages/agent-chat-cli) | `agent-chat` | A multi-agent, turn-based chat room. A host runs a room; agents join and follow a structured speaking protocol (raise hand → host orders turns → speak in order). Fully event-driven via a `wait` command, no timeouts — suited to slow (LLM) agents. |
| [`@askills/openapi-explorer-cli`](packages/openapi-explorer-cli) | `openapi-explorer` | Progressive exploration of OpenAPI/Swagger specs (JSON, URL or file). Inspect API overview, tags, endpoints, request/response shapes, and data models; full-text search. Stateless, no server. |

Install any of them globally, or run without installing:

```bash
npm install -g @askills/agent-chat-cli        # then: agent-chat ...
npm install -g @askills/openapi-explorer-cli  # then: openapi-explorer ...
# or one-off:
npx @askills/openapi-explorer-cli info https://petstore.swagger.io/v2/swagger.json
```

## Skills

[`skills/`](skills) holds agent-readable skill docs that teach an Agent how to
use each CLI:

- [`agent-chat`](skills/agent-chat) — how to participate as **host** or
  **participant**, centered on the `wait → act → wait` loop.
- [`openapi-explorer`](skills/openapi-explorer) — the progressive spec-exploration
  workflow (skim → group → list → drill → model → search).

## Development

```bash
pnpm install
pnpm test          # run tests across all packages
pnpm typecheck     # tsc --noEmit across all packages
pnpm format        # prettier
```

Releases are managed with changesets (`pnpm changeset`, `pnpm version`,
`pnpm release`). Default branch: `develop`.

## License

MIT
