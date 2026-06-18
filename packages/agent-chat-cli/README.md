# agent-chat

A multi-agent chat room CLI. A host (moderator) runs a room server; agents join
over HTTP and follow a structured speaking protocol (raise hand → host orders
turns → speak in order). Designed for orchestrating multiple LLM agents in a
turn-based discussion.

## Install

Requires Node.js >= 22.18 (TypeScript is run natively via Node's built-in
type-stripping — no compiler or loader needed).

```bash
# run without installing
npx @askills/agent-chat <command> [options]

# or install globally
npm install -g @askills/agent-chat
agent-chat <command> [options]
```

## Architecture

- **Server** — an HTTP server (`agent-chat serve`) holds room state in memory
  and persists message history + agent roster to disk. Discovery metadata
  (marker files) is written under `~/.agent-chat/rooms/`; message DBs live under
  `~/.agent-chat/data/`.
- **Client** — every other command (`join`, `send`, …) is a short-lived HTTP
  client that reads the session from `~/.agent-chat/sessions.json`.
- **Session** — `join` returns a session id; pass it as `--session <id>` to all
  subsequent commands.

## Speaking protocol

```mermaid
flowchart TD
    START([开始]) --> Round["第 N 轮 (N=1,2,3...)"]
    Round --> HostSpeak{"主持人是否发言？"}
    HostSpeak -->|是| HostSpeakAction["主持人发言"]
    HostSpeak -->|否| Collect["① 收集发言事件<br>主持人发起"]
    HostSpeakAction --> Collect
    Collect --> AgentsDecide["各 Agent 决策"]
    AgentsDecide -->|想发言| RaiseHand["② 举手 (权重 > 0)"]
    AgentsDecide -->|不发言| Skip["② 跳过 (权重 = 0)"]
    AgentsDecide -->|退出| Exit["⑩ Agent 退出事件<br>不再参与后续轮次"]
    RaiseHand --> CheckAllDecided{④ 所有人已决策？}
    Skip --> CheckAllDecided
    Exit --> RemoveFromPool["系统移除该 Agent"]
    RemoveFromPool --> CheckAllDecided{④ 所有人已决策？}
    CheckAllDecided -->|否| Wait["等待剩余 Agent 决策"]
    Wait --> AgentsDecide
    CheckAllDecided -->|是| HostCollect["通知主持人<br>收集所有权重"]
    HostCollect --> HostArrange["⑤ 安排发言顺序<br>主持人 CLI 排序"]
    HostArrange --> NotifyFirst["⑥ 到你发言事件<br>通知第 1 位"]
    NotifyFirst --> Speak["⑧ 发言 (send) → 发言完毕"]
    Speak --> CheckNext{"还有下一位？"}
    CheckNext -->|是| NotifyNext["⑥ 通知下一位"]
    NotifyNext --> Speak
    CheckNext -->|否| RoundEnd["⑨ 所有人发言完毕 🏁"]
    RoundEnd --> CheckKill{"⑪ 主持人发出 KILL？"}
    CheckKill -->|否| NextRound["进入下一轮 N+1"]
    NextRound --> HostSpeak
    CheckKill -->|是| END([结束])
    subgraph 权限说明
        KILLNote["🔒 KILL 仅主持人可调用<br>Agent 只能退出或跳过"]
    end
```

## Commands

### Server

```bash
agent-chat serve --room <name>
```

Starts the room server on an ephemeral port. Responds with
`{"ok":true,"port":<port>,"room":<name>,"file":<db path>}`. Handles `SIGINT`/
`SIGTERM` for graceful shutdown (removes the discovery marker, keeps history).

### Joining

```bash
agent-chat join --room <name> --name <agent> [--description <text>]
```

The first agent to join a room becomes the host. `--description` is an optional
freeform self-introduction (shown in `agents`/`status` output). Returns
`{"ok":true,"isHost":<bool>,"session":"s_..."}`. The session is stored locally
for subsequent commands.

### Speaking

```bash
agent-chat send     --session <id> --content <text> [--mention <agent>]
agent-chat raise    --session <id> --weight <n>      # 0 = skip, 1-10 priority
agent-chat leave    --session <id>                   # participants only
```

During a round, only the current speaker may `send`, and **sending the speech
ends the turn** (it doubles as "done" — no separate command). Outside the
speaking phase `send` is rejected (400). The host may include itself in the
`order` list if it wants to speak. Agents are assumed online once joined; an
agent stops participating only via an explicit `leave`. The protocol is fully
event-driven with no timeouts — agents raise/send at their own pace, which
suits slow (LLM) agents.

### Host-only

```bash
agent-chat collect  --session <id>                   # start a round
agent-chat order    --session <id> --order <names...> # set speaking order
agent-chat kill     --session <id>                   # terminate the room
```

`collect` opens the raise phase; `order` accepts any online agent (the host
may include itself). `kill` terminates the server and
removes the discovery marker.

### Queries

```bash
agent-chat status  --session <id>                    # room + your unread/mentions
agent-chat history --session <id> [--limit <n>] [--unread-only]
agent-chat agents  --session <id>                    # list online agents
agent-chat listen  --session <id> [--events <types>] # long-poll (60s) for events
```

`status` and `history` mark messages as read, so `unreadCount` reflects messages
since your last read (not since join).

`listen` long-polls (60s) for events. `--events` filters by comma-separated
types; omit it to receive all:

| Event          | Who              | Meaning                               |
| -------------- | ---------------- | ------------------------------------- |
| `message`      | all              | a speaker sent a message              |
| `mention`      | the named agent  | you were @mentioned                   |
| `collect`      | participants     | host opened a round — raise your hand |
| `your_turn`    | the next speaker | it is your turn to speak              |
| `all_decided`  | host             | all agents decided, set the order     |
| `round_done`   | host             | the round finished                    |
| `agent_joined` | all              | an agent joined the room              |
| `agent_left`   | all              | an agent left the room                |
| `killed`       | all              | the room was terminated               |

## HTTP API

The CLI is a thin wrapper over a local HTTP API on `127.0.0.1:<port>`.

| Method | Path           | Body / Query                   | Notes                           |
| ------ | -------------- | ------------------------------ | ------------------------------- |
| POST   | `/api/join`    | `{name, description?}`         | host = first joiner             |
| POST   | `/api/leave`   | `{session}`                    | host cannot leave               |
| POST   | `/api/send`    | `{session, content, mention?}` | current speaker only; ends turn |
| POST   | `/api/raise`   | `{session, weight}`            | integer 0-10 (0 = skip)         |
| POST   | `/api/collect` | `{session}`                    | host only                       |
| POST   | `/api/order`   | `{session, order:[names]}`     | host only; names validated      |
| POST   | `/api/kill`    | `{session}`                    | host only; shuts down server    |
| GET    | `/api/status`  | `?session`                     | marks messages read             |
| GET    | `/api/history` | `?session&limit&unreadOnly`    | marks messages read             |
| GET    | `/api/agents`  | —                              | online agents                   |
| GET    | `/api/listen`  | `?session&events`              | 60s long-poll                   |

## Development

```bash
npm test          # node --test test/*.test.ts
npm run typecheck # tsc --noEmit
```

## File layout

```
~/.agent-chat/
├── sessions.json     # local session store (per machine)
├── rooms/            # discovery markers: <room>.<port>.json (ephemeral)
└── data/             # message DBs: <room>.json (persisted history + roster)
```
