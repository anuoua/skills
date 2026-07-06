---
name: agent-chat
description: Use when an Agent needs to take part in a structured multi-agent chat-room discussion via the `agent-chat` CLI — either as the **host** (moderator who runs the room) or as a **participant**. Covers the turn-based speaking protocol (raise hand → host orders turns → speak in order), the `wait` command that drives the whole action loop, and how to read context. Trigger whenever the task involves `agent-chat`, hosting/joining a chat room, a multi-agent discussion, or coordinating speaking turns among agents — even if the CLI isn't named explicitly.
---

# Multi-agent chat room with `agent-chat`

`agent-chat` runs a turn-based chat room for multiple agents. One agent is the
**host** (moderator); the rest are **participants**. The host opens rounds,
agents raise their hands, the host sets the speaking order, and agents speak one
at a time. Everything is event-driven with **no timeouts** — slow (LLM) agents
are fine.

## The one pattern that matters: `wait` → act → `wait`

You do **not** poll. The room tells you when to act.

`agent-chat wait --session <id>` **blocks until the room needs you**, prints
exactly one instruction (the next command to run, with your session already
filled in), then **exits**. You run that command, then call `wait` again. That
is the whole loop.

**Important: never set a timeout on `agent-chat wait`.** The CLI is designed to
block indefinitely — the underlying tool (shell, subprocess) MUST NOT impose a
timeout. If a timeout does fire and `wait` returns empty output, simply
re-`wait` immediately; the room is still running and will respond when it needs
you.

What `wait` hands you depends on your role:

| You are… | `wait` returns | You then run |
|----------|----------------|--------------|
| participant | `collect` → *"raise your hand or skip"* | `history --unread-only` → `raise` |
| participant | `your_turn` → *"your turn to speak"* | `history --unread-only` → `send` |
| host | `presence` → *"+ alice joined / - bob left"* | nothing (context) — re-`wait`, or `collect` when ready |
| host | `all_decided` → *"set the speaking order"* + weights | `order` |
| host | `round_done` → *"start next round or terminate"* | `history --unread-only` → `collect` (next) or `kill` |
| either | `killed` → *"room terminated"* | stop |

So the rhythm is always: **`wait` → read the one printed command → run it → `wait` again.**

## Prerequisites

- Node.js >= 22.18.
- The CLI available as `agent-chat` (install with `npm install -g @askills/agent-chat-cli`, or prefix every command with `npx @askills/agent-chat-cli`).

## How to know your role

- **You are the host** if you were asked to *start* / *host* / *moderate* a room. You run `serve`.
- **You are a participant** if someone gave you a room file (`<room>.<port>.json`) or a session to join with. You run `join`.

---

## Example flows

### Host

```bash
# 1. Start
agent-chat serve --room planning --name alice
# → Room 'planning' started on port 54321 (detached)
# → File: /path/to/planning.54321.json
# → Host session: s_54321_a1b2c3

# 2. (optional) Opening remark while idle
agent-chat send --session s_54321_a1b2c3 --content "Welcome."

# 3. Watch for joins, then open a round
agent-chat wait --session s_54321_a1b2c3
# → [10:30:01] + bob joined
agent-chat wait --session s_54321_a1b2c3
# → [10:30:05] + carol joined
agent-chat collect --session s_54321_a1b2c3
# → Round 0 opened · waiting on: bob, carol

# 4. Wait for all to decide, then order
agent-chat wait --session s_54321_a1b2c3
# → All agents decided (round 0). Set the speaking order.
# →   Weights: bob=5, carol=3
agent-chat order --session s_54321_a1b2c3 --order bob carol
# → Order: bob → carol

# 5. Round done — read history, then next round or terminate
agent-chat wait --session s_54321_a1b2c3
# → Round 0 finished. Start the next round or terminate.
agent-chat history --session s_54321_a1b2c3 --unread-only
agent-chat collect --session s_54321_a1b2c3    # next round
# agent-chat kill --session s_54321_a1b2c3      # or terminate
```

### Participant

```bash
# 1. Join
agent-chat join --file planning.54321.json --name bob
# → Joined as bob
# → Session: s_54321_9f0d22

# 2. Round opened — read history, then raise or skip
agent-chat wait --session s_54321_9f0d22
# → Round 0 opened — raise your hand or skip.
agent-chat history --session s_54321_9f0d22 --unread-only
agent-chat raise --session s_54321_9f0d22 --weight 5     # 1-10 = want to speak
# agent-chat raise --session s_54321_9f0d22 --weight 0     # skip

# 3. Your turn — read history, then speak (send ends your turn)
agent-chat wait --session s_54321_9f0d22
# → Your turn to speak (round 0).
agent-chat history --session s_54321_9f0d22 --unread-only
agent-chat send --session s_54321_9f0d22 --content "My point…" [--mention carol]

# 4. Repeat, or leave
agent-chat leave --session s_54321_9f0d22
```

---

## Reading context (both roles)

You will usually get spoken content pushed to you via the events above, but you
can also pull it on demand:

- **`agent-chat status --session <id>`** — a *peek*: room phase, who's online,
  and your unread/mention counts. It does **not** change your unread state, so
  poll it freely.
- **`agent-chat history --session <id> [--unread-only]`** — read messages. This
  is the *consume* action: it advances your read cursor, so `unreadCount` (from
  `status`) reflects messages since your last `history`. Use `--unread-only` to
  see just what's new. Use it before you speak if you need to catch up on what
  others said.
- **`agent-chat agents --session <id>`** — list who's online (handy before
  `--mention` or before the host sets `--order`).

Note: your own sent messages never count as unread to you.

## Command quick reference

| Command | Role | Purpose |
|---------|------|---------|
| `serve --room <n> --name <host> [-d <text>]` | host | start room + become host; prints session + room file |
| `join --file <file> --name <a> [-d <text>]` | participant | join; prints session |
| `wait --session <id>` | both | **block until the room needs you**; prints next command |
| `raise --session <id> --weight <0-10>` | participant | raise hand (0 = skip) |
| `send --session <id> --content <t> [--mention <a>]` | both | speak (ends your turn; host may also send while idle) |
| `collect --session <id>` | host | open a round |
| `order --session <id> --order <names…>` | host | set speaking order (may include host) |
| `kill --session <id>` | host | terminate the room |
| `leave --session <id>` | participant | leave the room |
| `status --session <id>` | both | peek room + unread (doesn't consume) |
| `history --session <id> [--unread-only]` | both | read messages (consumes unread) |
| `agents --session <id>` | both | list online agents |

## Common mistakes to avoid

- **Don't poll in a loop.** Use `wait`; it blocks server-side until there's
  something for you to do.
- **Don't call `send` hoping to speak out of turn.** Outside your turn it's
  rejected (`Not in speaking phase` / `Not your turn`). The host may `send` while
  idle, participants may not.
- **Don't forget to re-`wait`.** Every action is followed by `wait` to learn the
  next step.
- **Don't set a timeout on `wait`.** The CLI is designed to block indefinitely;
  if a timeout fires and returns empty output, just re-`wait` immediately.
- **Host: don't lose the room file path** — participants need it to `join`.
- **`send` ends your turn.** Say everything in one `send` (or know that sending
  once finishes your turn for that round). Use `--mention` to direct a remark.
- **Always read history before acting.** Whether you're a participant raising
  hands or about to speak, or a host after `round_done` — run
  `history --unread-only` first so you don't miss context.
