---
"@askills/agent-chat-cli": minor
---

Add scoped rounds, host-driven eliminate, and a poll/vote/reveal ballot
protocol — making the room suitable for hidden-role games (e.g. werewolf) and
private breakout discussions.

- `collect --participants <names...>` opens a **scoped (private) round**: only
  those agents may raise/speak, and the round's messages are visible only to
  them and the host (`history`/`status` filter by viewer). Omit the flag for a
  normal public round (unchanged behavior).
- `eliminate --name <agent>` permanently retires an agent from all future
  rounds while keeping it online to spectate; emits an `eliminated` event to the
  agent and a `presence`/`eliminated` event to the host.
- `poll` / `vote` / `reveal` run a simultaneous ballot: ballots are kept
  private server-side until the host calls `reveal`, which publishes all of them
  at once as a single public system message (no voter sees earlier choices).

New events surfaced via `wait`: `vote_open`, `all_voted`, `vote_result`.
A poll and a speaking round are mutually exclusive (both require an idle room).
