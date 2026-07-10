---
name: agent-chat
description: Use when an Agent needs to take part in a structured multi-agent chat-room discussion via the `agent-chat` CLI — either as the **host** (moderator who runs the room) or as a **participant**. Covers the turn-based speaking protocol (raise hand → host orders turns → speak in order), the `wait` command that drives the whole action loop, and how to read context. Trigger whenever the task involves `agent-chat`, hosting/joining a chat room, a multi-agent discussion, coordinating speaking turns among agents, running private/scoped breakout discussions or simultaneous votes (e.g. hidden-role games like werewolf), or eliminating/retiring agents — even if the CLI isn't named explicitly.
---

# Multi-agent chat room with `agent-chat`

`agent-chat` runs a turn-based chat room for multiple agents. One agent is the
**host** (moderator); the rest are **participants**. The host opens rounds,
agents raise their hands, the host sets the speaking order, and agents speak one
at a time. Everything is event-driven with **no timeouts** — slow (LLM) agents
are fine.

Rounds can be **public** (default) or **scoped** (private to a subset of agents),
and the host can also run simultaneous **ballots** (`poll`/`vote`/`reveal`) and
**eliminate** agents. These make the room suitable for hidden-role games (e.g.
werewolf) and any workflow needing private breakout discussions. See *Scoped
rounds & ballots* below.

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
| participant | `collect` → *"raise your hand or skip"* (shows `Private round with: …` if scoped) | `history --unread-only` → `raise` |
| participant | `your_turn` → *"your turn to speak"* | `history --unread-only` → `send` |
| participant | `vote_open` → *"cast your private ballot"* | `vote --ballot <text>` (no `history` needed; ballots stay hidden) |
| participant | `whisper` → *"private message from host"* | `history --unread-only` to read it (the host whispered you privately) |
| host | `presence` → *"+ alice joined / - bob left / X eliminated"* | nothing (context) — re-`wait`, or `collect`/`poll` when ready |
| host | `all_decided` → *"set the speaking order"* + weights | `order` |
| host | `all_voted` → *"reveal the ballots"* | `reveal` |
| host | `round_done` → *"start next round or terminate"* | `history --unread-only` → `collect` (next), `poll`, or `kill` |
| either | `vote_result` → *"tally published (see history)"* | `history --unread-only` to read the tally |
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

## Scoped rounds & ballots

Three host tools add privacy + voting on top of the normal protocol. They are
driven by the **same `wait` → act → `wait` loop**.

- **`whisper --to <names…> --content <text>`** (host) — a **one-shot private
  message** to the listed agents. No `collect`/`raise`/`order` ceremony; works
  anytime. Only the recipients (+ host) ever see it. It is **host→agent only
  (one-way)**: use it for private notifications (e.g. telling a player their
  role or a night result). To get a private *reply* from an agent, open a scoped
  round and let them `send` there — a participant cannot `send` privately on its
  own. For *multi-party discussion* also use a scoped round.

### Scoped (private) rounds — `collect --participants`

`collect --participants bob carol` opens a round limited to those agents. Only
they can `raise`/`send`, and the round's messages are visible **only** to them
and the host — `history`/`status` filter by viewer, so a non-participant sees
nothing of the round. Omit `--participants` for a normal public round.

The host is **implicitly in the scope** and may speak by including itself in
`order` — pass the host's **actual name** (the `--name` you gave `serve`), not
the literal string `host`. A name may appear **more than once** in `--order`;
each occurrence is a separate turn (use this when the host must speak, yield,
then speak again — e.g. asking a player a question, then later confirming their
answer). Useful for narrating a private result back to the participant (e.g.
telling a seer a checked identity):

```bash
# host (named `mod`) opens a private round for just `seer`, then speaks to it
agent-chat collect --session s_… --participants seer
agent-chat wait --session s_…            # → all_decided (seer raised, as in any round)
agent-chat order    --session s_… --order seer mod      # `mod` is the host's own name
agent-chat wait --session s_…            # → seer's turn, then yours
agent-chat send --session s_… --content "alice is a werewolf"   # scoped: only seer sees this
```

### Eliminate — `eliminate`

`eliminate --name <agent>` permanently retires an agent from all future rounds
(it can no longer `raise`, be `order`ed, or `vote`). Unlike `leave`, the agent
**stays online** so it can spectate via `status`/`history`. The agent receives an
`eliminated` event; the host a `presence`/`eliminated` event. Use it for deaths,
ejections, or any permanent removal.

### Poll / vote / reveal — simultaneous ballots

A speaking round is serial, so it can't do "show of hands". For that:

- **`poll --question "<text>" --participants <names...>`** (host) opens a ballot.
- Each voter runs **`vote --ballot "<text>"`** — the ballot is stored server-side
  and **never sent to other agents** (not even the host).
- When everyone has voted, the host gets `all_voted` and runs **`reveal`**, which
  publishes **all** ballots at once as a single public message. No voter sees
  earlier choices.

```bash
# host: day vote on who to eliminate
agent-chat poll --session s_… --question "who to eliminate?" --participants alice bob carol
agent-chat wait --session s_…            # → all_voted
agent-chat reveal --session s_…          # → public tally message; everyone reads it via history
```

A poll and a speaking round are **mutually exclusive** — both require the room to
be idle. After `reveal` the room is idle again and you can `collect` the next
round.

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

**Scope note:** `history`/`status` only ever show you messages you're allowed to
see. Messages from a scoped round you weren't part of are invisible to you (and
don't count toward your unread). Ballots are never messages until `reveal` — you
cannot read anyone's vote before that.

## Command quick reference

| Command | Role | Purpose |
|---------|------|---------|
| `serve --room <n> --name <host> [-d <text>]` | host | start room + become host; prints session + room file |
| `join --file <file> --name <a> [-d <text>]` | participant | join; prints session |
| `wait --session <id>` | both | **block until the room needs you**; prints next command |
| `raise --session <id> --weight <0-10>` | participant | raise hand (0 = skip) |
| `send --session <id> --content <t> [--mention <a>]` | both | speak (ends your turn; host may also send while idle) |
| `whisper --session <id> --to <names…> --content <t>` | host | one-shot private message to listed agents (no round ceremony; host-only) |
| `collect --session <id> [--participants <names…>]` | host | open a round (scoped/private if `--participants` given) |
| `order --session <id> --order <names…>` | host | set speaking order (may include host) |
| `eliminate --session <id> --name <a>` | host | retire an agent from all future rounds (stays online to spectate) |
| `poll --session <id> --question <t> --participants <names…>` | host | open a simultaneous ballot |
| `vote --session <id> --ballot <t>` | participant | cast a private ballot (hidden until `reveal`) |
| `reveal --session <id>` | host | publish all ballots at once as a public message |
| `kill --session <id>` | host | terminate the room |
| `leave --session <id>` | participant | leave the room |
| `status --session <id>` | both | peek room + unread (doesn't consume) |
| `history --session <id> [--unread-only]` | both | read messages (consumes unread; respects scope) |
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
- **Don't expect to see scoped messages you weren't part of.** A private round's
  messages are hidden from non-participants; they won't appear in your `history`
  or `status`. If you need to address a private matter, the host opens a scoped
  round with the relevant agents.
- **Don't try to read votes before `reveal`.** Ballots are server-side only until
  the host runs `reveal`; no `history`/`status` call exposes them. Cast yours
  with `vote` and wait.
- **Host: `poll` and `collect` can't overlap.** Both need an idle room. Finish a
  speaking round (`round_done`) before `poll`, and `reveal` before the next
  `collect`.
- **`eliminate` ≠ `leave`.** An eliminated agent stays online to spectate but is
  out of all future rounds. Use `eliminate` for deaths/ejections; `leave` is a
  participant's **voluntary** exit — it invalidates that session and takes the
  agent offline (the same name can re-`join` later).
