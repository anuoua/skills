#!/usr/bin/env node

import { Command } from "commander";
import { spawn } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChatRoomServer } from "./server.ts";
import { portFromFile, portFromSession, roomFileName } from "./room.ts";
import { apiPost, apiGet } from "./client.ts";
import type { ChatEvent, Message } from "./types.ts";
import {
  fmtServe,
  fmtJoin,
  fmtSend,
  fmtRaise,
  fmtCollect,
  fmtOrder,
  fmtStatus,
  fmtHistory,
  fmtAgents,
  fmtWaitPrompt,
} from "./format.ts";

const indexScript = fileURLToPath(import.meta.url);

const program = new Command();
program
  .name("agent-chat")
  .description("Multi-agent chat room CLI")
  .version("0.1.0");

program.addHelpText(
  "afterAll",
  `
Quick reference:
  serve   --room <name> --name <host> [--description <text>]
  join    --file <room>.<port>.json --name <agent> [--description <text>]

  send    --session <id> --content <text> [--mention <agent>]
  raise   --session <id> --weight <n>
  collect --session <id>
  order   --session <id> --order <names...>
  kill    --session <id>
  leave   --session <id>
  status  --session <id>
  history --session <id> [--limit <n>] [--unread-only]
  agents  --session <id>
  wait    --session <id>                  # block until the room needs you to act
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

/** Read out `--session`'s encoded port or exit with an error. */
function resolvePortFromSession(sessionId: string): number {
  const port = portFromSession(sessionId);
  if (port === null) {
    console.error(
      `Invalid session '${sessionId}'. Get one from: agent-chat serve --room <name> --name <host>`,
    );
    process.exit(1);
  }
  return port;
}

/** Grab a free ephemeral port on 127.0.0.1 (bind to 0, read it, release). */
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as net.AddressInfo;
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

/** Poll a port until something is listening there (the detached child is up). */
function waitForListen(port: number, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const probe = (): Promise<boolean> =>
    new Promise((resolve) => {
      const s = net.createConnection({ port, host: "127.0.0.1" }, () => {
        s.end();
        resolve(true);
      });
      s.on("error", () => resolve(false));
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (await probe()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  })();
}

/** Build a session id `s_<port>_<6hex>` (host session, generated parent-side). */
function makeSessionId(port: number): string {
  const hex = randomUUID().replace(/-/g, "").slice(0, 6);
  return `s_${port}_${hex}`;
}

program
  .command("serve")
  .description("Start a chat room server (detached) and join as host")
  .requiredOption("--room <name>", "Room name")
  .requiredOption("--name <name>", "Host agent name")
  .option("--description <text>", "Host self-introduction")
  .action(async (opts) => {
    const dir = process.cwd();

    // Child mode: the detached background process that actually serves.
    if (process.env.AGENT_CHAT_SERVE_CHILD === "1") {
      const port = parseInt(process.env.AGENT_CHAT_PORT ?? "0", 10);
      const host: { name: string; description?: string; session: string } = {
        name: process.env.AGENT_CHAT_HOST_NAME!,
        session: process.env.AGENT_CHAT_HOST_SESSION!,
      };
      if (process.env.AGENT_CHAT_HOST_DESC)
        host.description = process.env.AGENT_CHAT_HOST_DESC;
      const room = createChatRoomServer({
        roomName: opts.room,
        port,
        dir,
        host,
      });
      await room.start();
      const shutdown = async (signal: string) => {
        await room.stop();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      return; // the http server keeps this process alive
    }

    // Parent mode: pick a port, mint the host session, spawn the detached child,
    // wait until it's listening, report port + file + host session, exit.
    const port = await pickFreePort();
    const session = makeSessionId(port);
    const child = spawn(
      process.execPath,
      [indexScript, "serve", "--room", opts.room, "--name", opts.name],
      {
        detached: true,
        stdio: "ignore",
        cwd: dir,
        env: {
          ...process.env,
          AGENT_CHAT_PORT: String(port),
          AGENT_CHAT_SERVE_CHILD: "1",
          AGENT_CHAT_HOST_NAME: opts.name,
          AGENT_CHAT_HOST_DESC: opts.description ?? "",
          AGENT_CHAT_HOST_SESSION: session,
        },
      },
    );
    child.unref();
    if (!(await waitForListen(port))) {
      console.error("Server failed to start within timeout");
      process.exit(1);
    }
    console.log(
      fmtServe({
        port,
        room: opts.room,
        file: join(dir, roomFileName(opts.room, port)),
        session,
      }),
    );
    process.exit(0);
  });

program
  .command("join")
  .description("Join a chat room as an agent")
  .requiredOption("--file <path>", "Room file (<room>.<port>.json) from serve")
  .requiredOption("--name <name>", "Agent name")
  .option("--description <text>", "Agent self-introduction")
  .action(async (opts) => {
    const port = portFromFile(opts.file);
    if (port === null) {
      console.error(
        `Could not read a port from '${opts.file}'. Expected a name like <room>.<port>.json.`,
      );
      process.exit(1);
    }
    const result = checkError(
      await apiPost(port, "/api/join", {
        name: opts.name,
        description: opts.description,
      }),
    );
    console.log(fmtJoin(opts.name, result.session as string));
  });

program
  .command("leave")
  .description("Leave a chat room (participants only)")
  .requiredOption("--session <id>", "Session ID from join")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    checkError(await apiPost(port, "/api/leave", { session: opts.session }));
    console.log("Left the room");
  });

program
  .command("send")
  .description("Send a message to the room")
  .requiredOption("--session <id>", "Session ID from join")
  .requiredOption("--content <text>", "Message content")
  .option("--mention <agent>", "Mention an agent")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    const result = checkError(
      await apiPost(port, "/api/send", {
        session: opts.session,
        content: opts.content,
        mention: opts.mention,
      }),
    );
    console.log(fmtSend(result.messageId as string));
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
    const port = resolvePortFromSession(opts.session);
    checkError(
      await apiPost(port, "/api/raise", {
        session: opts.session,
        weight: opts.weight,
      }),
    );
    console.log(fmtRaise(opts.weight));
  });

program
  .command("collect")
  .description("Collect hand raises (host only)")
  .requiredOption("--session <id>", "Host session ID from join")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    const result = checkError(
      await apiPost(port, "/api/collect", { session: opts.session }),
    );
    console.log(
      fmtCollect({
        roundNumber: result.roundNumber as number,
        participants: result.participants as string[],
      }),
    );
  });

program
  .command("order")
  .description("Set speaking order for current round (host only)")
  .requiredOption("--session <id>", "Host session ID from join")
  .requiredOption("--order <names...>", "Ordered agent names")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    checkError(
      await apiPost(port, "/api/order", {
        session: opts.session,
        order: opts.order,
      }),
    );
    console.log(fmtOrder(opts.order));
  });

program
  .command("kill")
  .description("Kill and terminate the chat room (host only)")
  .requiredOption("--session <id>", "Host session ID from join")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    checkError(await apiPost(port, "/api/kill", { session: opts.session }));
    console.log("Room terminated");
  });

program
  .command("status")
  .description("View room and your agent status")
  .requiredOption("--session <id>", "Session ID from join")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    const result = checkError(
      await apiGet(
        port,
        `/api/status?session=${encodeURIComponent(opts.session)}`,
      ),
    );
    console.log(
      fmtStatus(result as unknown as Parameters<typeof fmtStatus>[0]),
    );
  });

program
  .command("history")
  .description("View message history")
  .requiredOption("--session <id>", "Session ID from join")
  .option("--limit <n>", "Message limit", "50")
  .option("--unread-only", "Only unread messages")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    const params = new URLSearchParams();
    params.set("session", opts.session);
    params.set("limit", opts.limit);
    if (opts.unreadOnly) params.set("unreadOnly", "true");
    const result = checkError(
      await apiGet(port, `/api/history?${params.toString()}`),
    );
    console.log(fmtHistory(result.messages as Message[]));
  });

program
  .command("agents")
  .description("List online agents in the room")
  .requiredOption("--session <id>", "Session ID from join")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    const result = checkError(await apiGet(port, "/api/agents"));
    console.log(fmtAgents(result.agents as Parameters<typeof fmtAgents>[0]));
  });

program
  .command("wait")
  .description(
    "Block until the room needs you to act, then print what to do and exit.\n\n  collect      -> raise your hand (or skip)\n  your_turn   -> send your message\n  all_decided -> (host) set the speaking order\n  round_done  -> (host) start the next round or kill\n  presence    -> an agent joined or left (context)\n  killed       -> room terminated\n\nRe-run after each event. Message context is read with `history`.",
  )
  .requiredOption("--session <id>", "Session ID from join")
  .action(async (opts) => {
    const port = resolvePortFromSession(opts.session);
    const params = new URLSearchParams();
    params.set("session", opts.session);
    params.set(
      "events",
      "presence,collect,your_turn,all_decided,round_done,killed",
    );
    const result = checkError(
      await apiGet(port, `/api/listen?${params.toString()}`),
    );
    const events = result as unknown as ChatEvent[];
    for (const ev of events) console.log(fmtWaitPrompt(ev, opts.session));
  });

program.parse(process.argv);
