import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createChatRoomServer } from "../src/server.ts";
import { roomFileName, portFromFile, portFromSession } from "../src/room.ts";
import { fmtWaitPrompt } from "../src/format.ts";
import { apiPost, apiGet } from "../src/client.ts";
import type { ChatEvent } from "../src/types.ts";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface RoomHandle {
  room: ReturnType<typeof createChatRoomServer>;
  port: number;
  filePath: string;
  hostSession: string;
  stop: () => Promise<void>;
}

async function startRoom(opts: {
  roomName?: string;
  dir: string;
  host: { name: string; description?: string };
}): Promise<RoomHandle> {
  const hostSession = `s_host_${randomBytes(3).toString("hex")}`;
  const host: { name: string; description?: string; session: string } = {
    name: opts.host.name,
    session: hostSession,
  };
  if (opts.host.description !== undefined)
    host.description = opts.host.description;
  const room = createChatRoomServer({
    roomName: opts.roomName ?? "test-room",
    port: 0,
    dir: opts.dir,
    host,
  });
  await room.start();
  return {
    room,
    port: room.port,
    filePath: room.filePath,
    hostSession,
    stop: async () => {
      await room.stop();
    },
  };
}

async function joinAgent(
  port: number,
  name: string,
  description?: string,
): Promise<string> {
  const result = (await apiPost(port, "/api/join", { name, description })) as {
    session: string;
  };
  return result.session;
}

describe("file & session helpers", () => {
  it("roomFileName formats <room>.<port>.json", () => {
    assert.equal(roomFileName("test", 8080), "test.8080.json");
    assert.equal(roomFileName("游戏讨论", 38945), "游戏讨论.38945.json");
  });

  it("portFromFile parses the port from a room file path", () => {
    assert.equal(portFromFile("test.8080.json"), 8080);
    assert.equal(portFromFile("./dir/test-room.54321.json"), 54321);
    assert.equal(portFromFile("nope.json"), null);
    assert.equal(portFromFile("test.json"), null);
  });

  it("portFromSession parses the port from a session id", () => {
    assert.equal(portFromSession("s_54321_a1b2c3"), 54321);
    assert.equal(portFromSession("s_invalid"), null);
    assert.equal(portFromSession("s_bad"), null);
  });
});

describe("wait prompts (fmtWaitPrompt)", () => {
  const S = "s_54321_abc";

  it("collect → tells the agent to raise", () => {
    const ev: ChatEvent = {
      type: "collect",
      data: { roundNumber: 2 },
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.includes("raise"), out);
    assert.ok(out.includes(S), "session is filled in");
    assert.ok(out.includes("Round 2"));
  });

  it("your_turn → tells the agent to send", () => {
    const ev: ChatEvent = {
      type: "your_turn",
      data: { agentName: "alice", roundNumber: 2 },
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.includes("send"), out);
    assert.ok(out.includes(S));
  });

  it("all_decided → tells the host to order, with weights", () => {
    const ev: ChatEvent = {
      type: "all_decided",
      data: { roundNumber: 1, weights: { alice: 5, bob: 3 } },
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.includes("order"), out);
    assert.ok(out.includes("alice=5"));
    assert.ok(out.includes("bob=3"));
  });

  it("round_done → tells the host to collect or kill", () => {
    const ev: ChatEvent = {
      type: "round_done",
      data: { roundNumber: 1 },
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.includes("collect"), out);
    assert.ok(out.includes("kill"), out);
    assert.ok(out.includes("Round 1"));
  });

  it("killed → reports termination", () => {
    const ev: ChatEvent = {
      type: "killed",
      data: {},
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.toLowerCase().includes("terminated"), out);
  });

  it("presence → marks join (+) or leave (-)", () => {
    const join: ChatEvent = {
      type: "presence",
      data: { agentName: "alice", kind: "joined" },
      timestamp: 0,
    };
    const left: ChatEvent = {
      type: "presence",
      data: { agentName: "bob", kind: "left" },
      timestamp: 0,
    };
    assert.ok(fmtWaitPrompt(join, S).includes("+ alice joined"));
    assert.ok(fmtWaitPrompt(left, S).includes("- bob left"));
  });
});

describe("presence event (merged join/leave)", () => {
  it("emits a presence event to the host only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "presence-room",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");

      // host hears alice's join
      const heard = (await apiGet(
        port,
        `/api/listen?session=${hostSession}&events=presence`,
      )) as any;
      assert.ok(
        Array.isArray(heard) &&
          heard.some(
            (e: any) =>
              e.type === "presence" &&
              e.data.agentName === "alice" &&
              e.data.kind === "joined",
          ),
        "host hears alice's join as a presence event",
      );

      // alice must NOT hear presence — flush her listen with a collect event and
      // confirm she gets collect but no presence
      await apiPost(port, "/api/collect", { session: hostSession });
      const aliceSaw = (await apiGet(
        port,
        `/api/listen?session=${alice}&events=presence,collect`,
      )) as any;
      assert.ok(
        Array.isArray(aliceSaw) &&
          aliceSaw.some((e: any) => e.type === "collect"),
        "alice receives the collect event",
      );
      assert.ok(
        !aliceSaw.some((e: any) => e.type === "presence"),
        "non-host agents do not receive presence events",
      );

      // alice leaves -> host hears a 'left' presence event
      await apiPost(port, "/api/leave", { session: alice });
      const heard2 = (await apiGet(
        port,
        `/api/listen?session=${hostSession}&events=presence`,
      )) as any;
      assert.ok(
        Array.isArray(heard2) &&
          heard2.some(
            (e: any) =>
              e.type === "presence" &&
              e.data.agentName === "alice" &&
              e.data.kind === "left",
          ),
        "host hears alice's leave as a presence event",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chat room server with session", () => {
  let port = 0;
  let hostSession = "";
  let aliceSession = "";
  let bobSession = "";
  const dir = mkdtempSync(join(tmpdir(), "ac-"));
  let room: ReturnType<typeof createChatRoomServer>;

  before(async () => {
    const handle = await startRoom({
      dir,
      host: { name: "host", description: "主持" },
    });
    room = handle.room;
    port = handle.port;
    hostSession = handle.hostSession;
  });

  after(async () => {
    await room.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("host is registered at serve time", async () => {
    const result = (await apiGet(port, "/api/agents")) as any;
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].name, "host");
    assert.equal(result.agents[0].isHost, true);
  });

  it("join: an agent gets a non-host, port-encoded session", async () => {
    const result = (await apiPost(port, "/api/join", {
      name: "alice",
      description: "分析",
    })) as any;
    assert.equal(result.ok, true);
    assert.equal(result.isHost, false);
    assert.equal(portFromSession(result.session), port);
    aliceSession = result.session;
  });

  it("join: rejects the host's reserved name", async () => {
    const result = (await apiPost(port, "/api/join", { name: "host" })) as any;
    assert.equal(result.error, "Name is reserved by the host");
  });

  it("join: third agent", async () => {
    const result = (await apiPost(port, "/api/join", { name: "bob" })) as any;
    bobSession = result.session;
  });

  it("agents: lists host + joined agents", async () => {
    const result = (await apiGet(port, "/api/agents")) as any;
    assert.equal(result.agents.length, 3);
    assert.equal(result.agents[0].name, "host");
  });

  it("send: rejects invalid session", async () => {
    const result = (await apiPost(port, "/api/send", {
      session: "s_invalid",
      content: "test",
    })) as any;
    assert.equal(result.error, "Invalid session");
  });

  it("send: rejects outside speaking phase", async () => {
    const result = (await apiPost(port, "/api/send", {
      session: aliceSession,
      content: "hello",
    })) as any;
    assert.equal(result.error, "Not in speaking phase");
  });

  it("history: empty before any round", async () => {
    const result = (await apiGet(
      port,
      `/api/history?session=${aliceSession}`,
    )) as any;
    assert.equal(result.messages.length, 0);
  });

  it("history: rejects invalid session", async () => {
    const result = (await apiGet(port, "/api/history?session=s_bad")) as any;
    assert.equal(result.error, "Invalid session");
  });

  it("send: host may speak freely while idle (opening/closing remarks)", async () => {
    const result = (await apiPost(port, "/api/send", {
      session: hostSession,
      content: "welcome everyone",
    })) as any;
    assert.equal(result.ok, true);
    const status = (await apiGet(
      port,
      `/api/status?session=${hostSession}`,
    )) as any;
    assert.equal(status.roundState.phase, "idle");
    // the host's own message must not count as unread to the host
    assert.equal(status.unreadCount, 0, "own message is not unread to sender");
    const history = (await apiGet(
      port,
      `/api/history?session=${hostSession}`,
    )) as any;
    assert.ok(
      history.messages.some((m: any) => m.content === "welcome everyone"),
    );
  });

  it("collect: with host session", async () => {
    const result = (await apiPost(port, "/api/collect", {
      session: hostSession,
    })) as any;
    assert.equal(result.ok, true);
  });

  it("collect: rejects non-host session", async () => {
    const result = (await apiPost(port, "/api/collect", {
      session: aliceSession,
    })) as any;
    assert.equal(result.error, "Only host can perform this action");
  });

  it("raise: rejects invalid weight", async () => {
    const msg = "weight must be an integer between 0 and 10";
    assert.equal(
      (
        (await apiPost(port, "/api/raise", {
          session: aliceSession,
          weight: "high",
        })) as any
      ).error,
      msg,
    );
    assert.equal(
      (
        (await apiPost(port, "/api/raise", {
          session: aliceSession,
          weight: 11,
        })) as any
      ).error,
      msg,
    );
    assert.equal(
      (
        (await apiPost(port, "/api/raise", {
          session: aliceSession,
          weight: -1,
        })) as any
      ).error,
      msg,
    );
    assert.equal(
      (
        (await apiPost(port, "/api/raise", {
          session: aliceSession,
          weight: 3.5,
        })) as any
      ).error,
      msg,
    );
  });

  it("raise: with session", async () => {
    const result = (await apiPost(port, "/api/raise", {
      session: aliceSession,
      weight: 5,
    })) as any;
    assert.equal(result.ok, true);
  });

  it("second agent raises", async () => {
    const result = (await apiPost(port, "/api/raise", {
      session: bobSession,
      weight: 3,
    })) as any;
    assert.equal(result.ok, true);
  });

  it("order: rejects unavailable name", async () => {
    const result = (await apiPost(port, "/api/order", {
      session: hostSession,
      order: ["ghost"],
    })) as any;
    assert.equal(result.error, "Agent 'ghost' is not available to speak");
  });

  it("order: with host session", async () => {
    const result = (await apiPost(port, "/api/order", {
      session: hostSession,
      order: ["alice"],
    })) as any;
    assert.equal(result.ok, true);
  });

  it("send completes the turn", async () => {
    const sendResult = (await apiPost(port, "/api/send", {
      session: aliceSession,
      content: "my speech",
      mention: "host",
    })) as any;
    assert.equal(sendResult.ok, true);
    const status = (await apiGet(
      port,
      `/api/status?session=${hostSession}`,
    )) as any;
    assert.equal(status.roundState.phase, "idle");
  });

  it("full round: collect → raise → order → speak", async () => {
    const charlieSession = await joinAgent(port, "charlie");

    let result: any = await apiPost(port, "/api/collect", {
      session: hostSession,
    });
    assert.equal(result.ok, true);

    result = await apiPost(port, "/api/raise", {
      session: bobSession,
      weight: 3,
    });
    assert.equal(result.ok, true);
    result = await apiPost(port, "/api/raise", {
      session: charlieSession,
      weight: 7,
    });
    assert.equal(result.ok, true);
    result = await apiPost(port, "/api/raise", {
      session: aliceSession,
      weight: 1,
    });
    assert.equal(result.ok, true);

    result = await apiPost(port, "/api/order", {
      session: hostSession,
      order: ["charlie", "bob"],
    });
    assert.deepEqual(result.order, ["charlie", "bob"]);

    // sending the speech ends the speaker's turn (no separate done)
    result = await apiPost(port, "/api/send", {
      session: charlieSession,
      content: "charlie speaking",
    });
    assert.equal(result.ok, true);

    result = await apiPost(port, "/api/send", {
      session: bobSession,
      content: "bob speaking",
    });
    assert.equal(result.ok, true);

    result = await apiGet(port, `/api/status?session=${hostSession}`);
    assert.equal(result.roundState.phase, "idle");
    assert.equal(result.roundState.roundNumber, 2);
  });

  it("status: with session", async () => {
    const result = (await apiGet(
      port,
      `/api/status?session=${aliceSession}`,
    )) as any;
    assert.equal(result.roomName, "test-room");
    assert.equal(result.host, "host");
    assert.equal(result.isKilled, false);
  });

  it("status: rejects invalid session", async () => {
    const result = (await apiGet(port, "/api/status?session=s_bad")) as any;
    assert.equal(result.error, "Invalid session");
  });

  it("leave: with session", async () => {
    const result = (await apiPost(port, "/api/leave", {
      session: aliceSession,
    })) as any;
    assert.equal(result.ok, true);
  });

  it("left agent cannot send (Bug 2)", async () => {
    const result = (await apiPost(port, "/api/send", {
      session: aliceSession,
      content: "ghost",
    })) as any;
    assert.equal(result.error, "Invalid session");
  });

  it("leave: host cannot leave", async () => {
    const result = (await apiPost(port, "/api/leave", {
      session: hostSession,
    })) as any;
    assert.equal(result.error, "Host cannot leave, use kill instead");
  });

  it("listen: returns events with a valid session", async () => {
    const result = (await apiGet(
      port,
      `/api/listen?session=${bobSession}&events=message`,
    )) as any;
    assert.ok(Array.isArray(result));
  });

  it("listen: rejects invalid session", async () => {
    const result = (await apiGet(port, "/api/listen?session=s_bad")) as any;
    assert.equal(result.error, "Invalid session");
  });

  it("messages are persisted to the room file", async () => {
    const onDisk = JSON.parse(readFileSync(room.filePath, "utf-8")) as any[];
    assert.ok(Array.isArray(onDisk));
    assert.ok(
      onDisk.some((m) => m.content === "charlie speaking"),
      "sent message should be in the file",
    );
  });

  it("kill: host can kill the room", async () => {
    const result = (await apiPost(port, "/api/kill", {
      session: hostSession,
    })) as any;
    assert.equal(result.ok, true);
  });
});

describe("offline agent is skipped in speaking order (Issue 7)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ac-"));

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("advances past an agent who left mid-order", async () => {
    const handle = await startRoom({
      dir,
      roomName: "skip-room",
      host: { name: "host", description: "主持" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const a = await joinAgent(port, "a");
      const b = await joinAgent(port, "b");
      const c = await joinAgent(port, "c");

      await apiPost(port, "/api/collect", { session: hostSession });
      await apiPost(port, "/api/raise", { session: a, weight: 1 });
      await apiPost(port, "/api/raise", { session: b, weight: 1 });
      await apiPost(port, "/api/raise", { session: c, weight: 1 });

      // all three are online and participating when order is set
      const orderResult = (await apiPost(port, "/api/order", {
        session: hostSession,
        order: ["a", "b", "c"],
      })) as any;
      assert.equal(orderResult.ok, true);

      // 'b' leaves AFTER ordering, before its turn arrives
      await apiPost(port, "/api/leave", { session: b });

      // 'a' (current speaker) sends -> turn ends, 'b' is offline and skipped, 'c' is next
      const aSend = (await apiPost(port, "/api/send", {
        session: a,
        content: "a",
      })) as any;
      assert.equal(aSend.ok, true);

      // 'c' should now be the current speaker (b was skipped); sending ends the round
      const cSend = (await apiPost(port, "/api/send", {
        session: c,
        content: "c",
      })) as any;
      assert.equal(cSend.ok, true);

      const status = (await apiGet(
        port,
        `/api/status?session=${hostSession}`,
      )) as any;
      assert.equal(status.roundState.phase, "idle");
    } finally {
      await stop();
    }
  });
});

describe("unread tracking via lastReadAt (Issue 11)", () => {
  it("status peeks without consuming; history marks read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "unread-room",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    // host is the reader; bob is the sole speaker (messages only exist inside rounds)
    const speak = async (content: string) => {
      await apiPost(port, "/api/collect", { session: hostSession });
      await apiPost(port, "/api/raise", { session: bob, weight: 1 });
      await apiPost(port, "/api/order", {
        session: hostSession,
        order: ["bob"],
      });
      await apiPost(port, "/api/send", { session: bob, content });
    };
    let bob = "";
    try {
      bob = await joinAgent(port, "bob");

      await speak("msg1");
      // history is the consume action — it advances the read cursor
      await apiGet(port, `/api/history?session=${hostSession}`);

      await speak("msg2");

      // status is a peek: two calls in a row both report the same unread count
      const peek1 = (await apiGet(
        port,
        `/api/status?session=${hostSession}`,
      )) as any;
      const peek2 = (await apiGet(
        port,
        `/api/status?session=${hostSession}`,
      )) as any;
      assert.equal(peek1.unreadCount, 1, "only msg2 is unread");
      assert.equal(peek2.unreadCount, 1, "status does not consume unread");

      // history marks read; status then reports zero
      await apiGet(port, `/api/history?session=${hostSession}`);
      const afterRead = (await apiGet(
        port,
        `/api/status?session=${hostSession}`,
      )) as any;
      assert.equal(afterRead.unreadCount, 0);
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
