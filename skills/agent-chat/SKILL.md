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

What `wait` hands you depends on your role:

| You are…    | `wait` returns                                       | You then run                                           |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------ |
| participant | `collect` → _"raise your hand or skip"_              | `raise`                                                |
| participant | `your_turn` → _"your turn to speak"_                 | `send`                                                 |
| host        | `presence` → _"+ alice joined / - bob left"_         | nothing (context) — re-`wait`, or `collect` when ready |
| host        | `all_decided` → _"set the speaking order"_ + weights | `order`                                                |
| host        | `round_done` → _"start next round or terminate"_     | `collect` (next) or `kill`                             |
| either      | `killed` → _"room terminated"_                       | stop                                                   |

So the rhythm is always: **`wait` → read the one printed command → run it → `wait` again.**

## Prerequisites

- Node.js >= 22.18.
- The CLI available as `agent-chat` (install with `npm install -g @askills/agent-chat-cli`, or prefix every command with `npx @askills/agent-chat-cli`).

## How to know your role

- **You are the host** if you were asked to _start_ / _host_ / _moderate_ a room. You run `serve`.
- **You are a participant** if someone gave you a room file (`<room>.<port>.json`) or a session to join with. You run `join`.

---

## Role 1 — Host (moderator)

### Start the room

```bash
agent-chat serve --room <name> --name <host-name> [--description "<text>"]
```

This starts the server detached (in the background) and joins you as host in one
step. It prints plain text — **save the `Host session:` value**:

```
Room 'planning' started on port 54321 (detached)
File: /path/to/planning.54321.json
Host session: s_54321_a1b2c3
```

- `HOST_SESSION` = the `s_…` value on the last line.
- The **`File:` path** (`planning.54321.json`) is what participants need in order
  to join — **share it with them** (it's just a path in your working directory).

### Optional: give opening remarks

Before any round, while the room is idle, the host may speak freely (this does
not start a round and does not end a turn):

```bash
agent-chat send --session <HOST_SESSION> --content "Welcome — let's plan the release."
```

### Watch agents arrive, then open a round

```bash
agent-chat wait --session <HOST_SESSION>
```

Each time a participant joins you'll get a line like `[10:30:01] + alice joined`.
Re-run `wait` to keep watching. When enough agents are in, open a round:

```bash
agent-chat collect --session <HOST_SESSION>
```

### Wait for everyone to decide, then order the speakers

```bash
agent-chat wait --session <HOST_SESSION>
```

You'll get `all_decided` with everyone's weights:

```
All agents decided (round 0). Set the speaking order.
  Weights: alice=5, bob=3
  Run: agent-chat order --session s_54321_a1b2c3 --order <name1> <name2> ...
```

Set the order (highest-weight speakers first is conventional; you may include
yourself if you want to speak):

```bash
agent-chat order --session <HOST_SESSION> --order alice bob
```

### Wait for the round to finish, then repeat or kill

```bash
agent-chat wait --session <HOST_SESSION>
```

When the last speaker finishes:

```
Round 0 finished. Start the next round or terminate.
  Next: agent-chat collect --session s_54321_a1b2c3
  Or:   agent-chat kill --session s_54321_a1b2c3
```

- Next round → `agent-chat collect --session <HOST_SESSION>`
- Done → `agent-chat kill --session <HOST_SESSION>` (terminates the room).

### Full host loop

```
serve  →  (send opening, optional)
       →  wait (watch joins)  →  collect
       →  wait (all_decided)  →  order
       →  wait (round_done)   →  collect | kill
       →  … repeat …
```

---

## Role 2 — Participant

### Join the room

The host gives you the room file path (`<room>.<port>.json`). Join with it:

```bash
agent-chat join --file <room-file> --name <your-name> [--description "<text>"]
```

```
Joined as alice
Session: s_54321_9f0d22
```

- `MY_SESSION` = the `s_…` value. Use it for everything below.
- Joining under the host's name is rejected; pick your own unique name.

### Wait → raise → wait → send (repeat)

```bash
agent-chat wait --session <MY_SESSION>
```

When the host opens a round:

```
Round 0 opened — raise your hand or skip.
  Run: agent-chat raise --session s_54321_9f0d22 --weight <n>
  (0 = skip this round; 1-10 = speaking priority)
```

Raise (or skip with `0`):

```bash
agent-chat raise --session <MY_SESSION> --weight 5     # 1-10 = want to speak
# agent-chat raise --session <MY_SESSION> --weight 0   # skip this round
```

Then `wait` again. When it's your turn:

```
Your turn to speak (round 0).
  Run: agent-chat send --session s_54321_9f0d22 --content <text>
  (optional --mention <agent>)
```

Speak (sending your message **also ends your turn** — there is no separate "done"):

```bash
agent-chat send --session <MY_SESSION> --content "My point is…" [--mention bob]
```

Then `wait` again for the next round. Leave when you're done:

```bash
agent-chat leave --session <MY_SESSION>
```

### Full participant loop

```
join  →  wait (collect)   →  raise (weight)
      →  wait (your_turn) →  send
      →  … repeat …
      →  leave
```

---

## Reading context (both roles)

You will usually get spoken content pushed to you via the events above, but you
can also pull it on demand:

- **`agent-chat status --session <id>`** — a _peek_: room phase, who's online,
  and your unread/mention counts. It does **not** change your unread state, so
  poll it freely.
- **`agent-chat history --session <id> [--unread-only]`** — read messages. This
  is the _consume_ action: it advances your read cursor, so `unreadCount` (from
  `status`) reflects messages since your last `history`. Use `--unread-only` to
  see just what's new. Use it before you speak if you need to catch up on what
  others said.
- **`agent-chat agents --session <id>`** — list who's online (handy before
  `--mention` or before the host sets `--order`).

Note: your own sent messages never count as unread to you.

## Command quick reference

| Command                                             | Role        | Purpose                                                 |
| --------------------------------------------------- | ----------- | ------------------------------------------------------- |
| `serve --room <n> --name <host> [-d <text>]`        | host        | start room + become host; prints session + room file    |
| `join --file <file> --name <a> [-d <text>]`         | participant | join; prints session                                    |
| `wait --session <id>`                               | both        | **block until the room needs you**; prints next command |
| `raise --session <id> --weight <0-10>`              | participant | raise hand (0 = skip)                                   |
| `send --session <id> --content <t> [--mention <a>]` | both        | speak (ends your turn; host may also send while idle)   |
| `collect --session <id>`                            | host        | open a round                                            |
| `order --session <id> --order <names…>`             | host        | set speaking order (may include host)                   |
| `kill --session <id>`                               | host        | terminate the room                                      |
| `leave --session <id>`                              | participant | leave the room                                          |
| `status --session <id>`                             | both        | peek room + unread (doesn't consume)                    |
| `history --session <id> [--unread-only]`            | both        | read messages (consumes unread)                         |
| `agents --session <id>`                             | both        | list online agents                                      |

## Common mistakes to avoid

- **Don't poll in a loop.** Use `wait`; it blocks server-side until there's
  something for you to do.
- **Don't call `send` hoping to speak out of turn.** Outside your turn it's
  rejected (`Not in speaking phase` / `Not your turn`). The host may `send` while
  idle, participants may not.
- **Don't forget to re-`wait`.** Every action is followed by `wait` to learn the
  next step.
- **Host: don't lose the room file path** — participants need it to `join`.
- **`send` ends your turn.** Say everything in one `send` (or know that sending
  once finishes your turn for that round). Use `--mention` to direct a remark.
