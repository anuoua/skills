#!/usr/bin/env node

import { Command } from "commander";
import { join } from "node:path";
import { createChatRoomServer } from "./server.ts";
import {
  findRoomFile,
  dbFileName,
  getDataDir,
  ensureBaseDirs,
} from "./room.ts";
import { getSession, saveSession, removeSession } from "./session.ts";
import { apiPost, apiGet } from "./client.ts";
import type { ServerConfig } from "./types.ts";

const program = new Command();
program
  .name("agent-chat")
  .description("Multi-agent chat room CLI")
  .version("0.1.0");

program.addHelpText(
  "afterAll",
  `
Quick reference:
  serve   --room <name>
  join    --room <name> --name <agent> [--description <text>]

  send    --session <id> --content <text> [--mention <agent>]
  raise   --session <id> --weight <n>
  collect --session <id>
  order   --session <id> --order <names...>
  kill    --session <id>
  leave   --session <id>
  status  --session <id>
  history --session <id> [--limit <n>] [--unread-only]
  agents  --session <id>
  listen  --session <id> [--events <types>]
Use: agent-chat <command> --help for details
`,
);

function checkError<T extends Record<string, unknown>>(result: T): T {
  if (result && typeof result.error === "string") {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
  return result;
}

async function findRoom(roomName: string) {
  const found = await findRoomFile(roomName);
  if (!found) {
    console.error(
      `Room '${roomName}' not found. Start it with: agent-chat serve --room "${roomName}"`,
    );
    process.exit(1);
  }
  return found;
}

function resolveSession(sessionId: string) {
  const info = getSession(sessionId);
  if (!info) {
    console.error(
      `Session '${sessionId}' not found. Join a room first with: agent-chat join --room <name> --name <agent>`,
    );
    process.exit(1);
  }
  return info;
}

function output(result: Record<string, unknown>) {
  checkError(result);
  console.log(JSON.stringify(result));
}

program
  .command("serve")
  .description("Start a chat room server")
  .requiredOption("--room <name>", "Room name")
  .action(async (opts) => {
    ensureBaseDirs();
    const dbPath = join(getDataDir(), dbFileName(opts.room));

    const config: ServerConfig = {
      roomName: opts.room,
      port: 0,
      dbPath,
    };

    const room = createChatRoomServer(config);
    await room.start();

    const shutdown = async (signal: string) => {
      console.error(`Received ${signal}, shutting down...`);
      await room.stop();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    console.log(
      JSON.stringify({
        ok: true,
        port: room.port,
        room: opts.room,
        file: dbPath,
      }),
    );
  });

program
  .command("join")
  .description("Join a chat room as an agent")
  .requiredOption("--room <name>", "Room name")
  .requiredOption("--name <name>", "Agent name")
  .option("--description <text>", "Agent self-introduction")
  .action(async (opts) => {
    const { port } = await findRoom(opts.room);
    const result = checkError(
      await apiPost(port, "/api/join", {
        name: opts.name,
        description: opts.description,
      }),
    );
    const session = result.session;
    if (typeof session === "string") {
      saveSession(session, { port, agentName: opts.name, roomName: opts.room });
    }
    console.log(JSON.stringify(result));
  });

program
  .command("leave")
  .description("Leave a chat room (participants only)")
  .requiredOption("--session <id>", "Session ID from join")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(await apiPost(port, "/api/leave", { session: opts.session }));
    removeSession(opts.session);
  });

program
  .command("send")
  .description("Send a message to the room")
  .requiredOption("--session <id>", "Session ID from join")
  .requiredOption("--content <text>", "Message content")
  .option("--mention <agent>", "Mention an agent")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(
      await apiPost(port, "/api/send", {
        session: opts.session,
        content: opts.content,
        mention: opts.mention,
      }),
    );
  });

program
  .command("raise")
  .description("Raise hand with priority (integer 0-10, 0 = skip)")
  .requiredOption("--session <id>", "Session ID from join")
  .requiredOption(
    "--weight <n>",
    "Raise priority, integer 0-10 (0 = skip)",
    parseInt,
  )
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(
      await apiPost(port, "/api/raise", {
        session: opts.session,
        weight: opts.weight,
      }),
    );
  });

program
  .command("collect")
  .description("Collect hand raises (host only)")
  .requiredOption("--session <id>", "Host session ID from join")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(await apiPost(port, "/api/collect", { session: opts.session }));
  });

program
  .command("order")
  .description("Set speaking order for current round (host only)")
  .requiredOption("--session <id>", "Host session ID from join")
  .requiredOption("--order <names...>", "Ordered agent names")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(
      await apiPost(port, "/api/order", {
        session: opts.session,
        order: opts.order,
      }),
    );
  });

program
  .command("kill")
  .description("Kill and terminate the chat room (host only)")
  .requiredOption("--session <id>", "Host session ID from join")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(await apiPost(port, "/api/kill", { session: opts.session }));
    removeSession(opts.session);
  });

program
  .command("status")
  .description("View room and your agent status")
  .requiredOption("--session <id>", "Session ID from join")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(
      await apiGet(
        port,
        `/api/status?session=${encodeURIComponent(opts.session)}`,
      ),
    );
  });

program
  .command("history")
  .description("View message history")
  .requiredOption("--session <id>", "Session ID from join")
  .option("--limit <n>", "Message limit", "50")
  .option("--unread-only", "Only unread messages")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    const params = new URLSearchParams();
    params.set("session", opts.session);
    params.set("limit", opts.limit);
    if (opts.unreadOnly) params.set("unreadOnly", "true");
    output(await apiGet(port, `/api/history?${params.toString()}`));
  });

program
  .command("agents")
  .description("List online agents in the room")
  .requiredOption("--session <id>", "Session ID from join")
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    output(await apiGet(port, "/api/agents"));
  });

program
  .command("listen")
  .description(
    "Long-poll for events\n\n  Event types:\n    message       a speaker sent a message\n    mention       you were @mentioned\n    collect       host opened a round (raise your hand)\n    your_turn     it is your turn to speak\n    all_decided   (host) all agents decided, set the order\n    round_done    (host) the round finished\n    agent_joined  an agent joined the room\n    agent_left    an agent left the room\n    killed        the room was terminated\n  Omit --events to receive all of them.",
  )
  .requiredOption("--session <id>", "Session ID from join")
  .option(
    "--events <types>",
    "Comma-separated event types to filter on (see list above)",
  )
  .action(async (opts) => {
    const { port } = resolveSession(opts.session);
    const params = new URLSearchParams();
    params.set("session", opts.session);
    if (opts.events) params.set("events", opts.events);
    output(await apiGet(port, `/api/listen?${params.toString()}`));
  });

program.parse(process.argv);
