import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createChatRoomServer } from "../src/server.ts";
import { roomFileName, portFromFile, portFromSession } from "../src/room.ts";
import { fmtWaitPrompt, fmtEvent } from "../src/format.ts";
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

  it("vote_open → tells the agent to vote", () => {
    const ev: ChatEvent = {
      type: "vote_open",
      data: { question: "who?", participants: ["alice"] },
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.includes("vote"), out);
    assert.ok(out.includes("--ballot"), out);
    assert.ok(out.includes("who?"));
  });

  it("all_voted → tells the host to reveal", () => {
    const ev: ChatEvent = {
      type: "all_voted",
      data: { question: "who?", count: 3 },
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.includes("reveal"), out);
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

  it("whisper → tells the recipient to read it via history", () => {
    const ev: ChatEvent = {
      type: "whisper",
      data: { from: "host", message: { content: "your role" } },
      timestamp: 0,
    };
    const out = fmtWaitPrompt(ev, S);
    assert.ok(out.includes("host"), out);
    assert.ok(out.includes("whisper") || out.includes("private"), out);
    assert.ok(out.includes("history"), out);
    assert.ok(out.includes(S), "session is filled in");
  });

  it("whisper event → renders a header line with from + indented content", () => {
    const ev: ChatEvent = {
      type: "whisper",
      data: { from: "host", message: { content: "you are the seer" } },
      timestamp: 0,
    };
    const out = fmtEvent(ev);
    assert.ok(out.includes("whisper"), out);
    assert.ok(out.includes("host"), out);
    assert.ok(out.includes("you are the seer"), out);
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

describe("host-driven eliminate", () => {
  it("removes an agent from future rounds and notifies both sides", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "elim-room",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      const bob = await joinAgent(port, "bob");

      const result = (await apiPost(port, "/api/eliminate", {
        session: hostSession,
        name: "alice",
      })) as any;
      assert.equal(result.ok, true);

      // alice is told she was eliminated
      const aliceHeard = (await apiGet(
        port,
        `/api/listen?session=${alice}&events=eliminated`,
      )) as any;
      assert.ok(
        Array.isArray(aliceHeard) &&
          aliceHeard.some(
            (e: any) => e.type === "eliminated" && e.data.agentName === "alice",
          ),
        "eliminated agent receives an eliminated event",
      );

      // host sees a presence-style 'eliminated' notice
      const hostHeard = (await apiGet(
        port,
        `/api/listen?session=${hostSession}&events=presence`,
      )) as any;
      assert.ok(
        Array.isArray(hostHeard) &&
          hostHeard.some(
            (e: any) =>
              e.type === "presence" &&
              e.data.agentName === "alice" &&
              e.data.kind === "eliminated",
          ),
        "host hears the elimination as a presence event",
      );

      // open a round: alice is not a participant anymore, bob still is
      const collect = (await apiPost(port, "/api/collect", {
        session: hostSession,
      })) as any;
      assert.deepEqual(collect.participants, ["bob"]);

      // alice trying to raise is rejected
      const raiseRes = (await apiPost(port, "/api/raise", {
        session: alice,
        weight: 5,
      })) as any;
      assert.ok(raiseRes.error, "eliminated agent cannot raise");

      // eliminated agents stay online to spectate (history still works)
      const history = (await apiGet(
        port,
        `/api/history?session=${alice}`,
      )) as any;
      assert.ok(
        Array.isArray(history.messages),
        "eliminated agent can spectate",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-host, missing name, host target, unknown, and double eliminate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "elim-validate",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");

      assert.equal(
        (
          (await apiPost(port, "/api/eliminate", {
            session: alice,
            name: "alice",
          })) as any
        ).error,
        "Only host can perform this action",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/eliminate", {
            session: hostSession,
          })) as any
        ).error,
        "name is required",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/eliminate", {
            session: hostSession,
            name: "host",
          })) as any
        ).error,
        "Cannot eliminate the host",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/eliminate", {
            session: hostSession,
            name: "ghost",
          })) as any
        ).error,
        "Agent not found",
      );

      await apiPost(port, "/api/eliminate", {
        session: hostSession,
        name: "alice",
      });
      assert.equal(
        (
          (await apiPost(port, "/api/eliminate", {
            session: hostSession,
            name: "alice",
          })) as any
        ).error,
        "Agent already eliminated",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("eliminating the current speaker advances the turn", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "elim-advance",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      const bob = await joinAgent(port, "bob");

      await apiPost(port, "/api/collect", { session: hostSession });
      await apiPost(port, "/api/raise", { session: alice, weight: 1 });
      await apiPost(port, "/api/raise", { session: bob, weight: 1 });
      await apiPost(port, "/api/order", {
        session: hostSession,
        order: ["alice", "bob"],
      });

      // alice is the current speaker; eliminate her mid-turn → bob is up next
      await apiPost(port, "/api/eliminate", {
        session: hostSession,
        name: "alice",
      });

      const bobTurn = (await apiGet(
        port,
        `/api/listen?session=${bob}&events=your_turn`,
      )) as any;
      assert.ok(
        Array.isArray(bobTurn) &&
          bobTurn.some((e: any) => e.type === "your_turn"),
        "bob becomes the current speaker after alice is eliminated",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scoped rounds (collect --participants)", () => {
  it("restricts raise/collect-event to the named participants", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "scope-room",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      const bob = await joinAgent(port, "bob");
      const charlie = await joinAgent(port, "charlie");

      const result = (await apiPost(port, "/api/collect", {
        session: hostSession,
        participants: ["alice", "bob"],
      })) as any;
      assert.equal(result.ok, true);
      assert.deepEqual(result.participants, ["alice", "bob"]);

      // alice & bob can raise; charlie cannot
      assert.equal(
        (await apiPost(port, "/api/raise", { session: alice, weight: 1 })).ok,
        true,
      );
      assert.equal(
        (await apiPost(port, "/api/raise", { session: bob, weight: 1 })).ok,
        true,
      );
      const charlieRaise = (await apiPost(port, "/api/raise", {
        session: charlie,
        weight: 1,
      })) as any;
      assert.equal(charlieRaise.error, "Not a participant in this round");

      // alice got a collect event; charlie did not (drain alice, charlie empty
      // for collect — verified indirectly because raise was the gate)
      const aliceCollect = (await apiGet(
        port,
        `/api/listen?session=${alice}&events=collect`,
      )) as any;
      assert.ok(
        Array.isArray(aliceCollect) &&
          aliceCollect.some((e: any) => e.type === "collect"),
        "invited participant receives the collect event",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hides scoped messages from non-participants; shows them to participants and host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "scope-vis",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      const bob = await joinAgent(port, "bob");
      const charlie = await joinAgent(port, "charlie");

      await apiPost(port, "/api/collect", {
        session: hostSession,
        participants: ["alice", "bob"],
      });
      await apiPost(port, "/api/raise", { session: alice, weight: 1 });
      await apiPost(port, "/api/raise", { session: bob, weight: 1 });
      // host includes itself so it can narrate privately to the scope
      await apiPost(port, "/api/order", {
        session: hostSession,
        order: ["alice", "host"],
      });
      await apiPost(port, "/api/send", {
        session: alice,
        content: "alice-secret",
      });
      await apiPost(port, "/api/send", {
        session: hostSession,
        content: "host-secret",
      });

      const aliceHist = (await apiGet(
        port,
        `/api/history?session=${alice}`,
      )) as any;
      const bobHist = (await apiGet(
        port,
        `/api/history?session=${bob}`,
      )) as any;
      const charlieHist = (await apiGet(
        port,
        `/api/history?session=${charlie}`,
      )) as any;
      const hostHist = (await apiGet(
        port,
        `/api/history?session=${hostSession}`,
      )) as any;

      const contents = (h: any) => (h.messages as any[]).map((m) => m.content);
      assert.ok(
        contents(aliceHist).includes("alice-secret") &&
          contents(aliceHist).includes("host-secret"),
        "participant sees scoped messages",
      );
      assert.ok(
        contents(bobHist).includes("alice-secret") &&
          contents(bobHist).includes("host-secret"),
        "non-speaking participant sees scoped messages",
      );
      assert.ok(
        contents(hostHist).includes("alice-secret") &&
          contents(hostHist).includes("host-secret"),
        "host sees all scoped messages",
      );
      assert.ok(
        !contents(charlieHist).some((c) => c.includes("secret")),
        "non-participant cannot see any scoped message",
      );

      // charlie's status unread count must not leak scoped messages either
      const charlieStatus = (await apiGet(
        port,
        `/api/status?session=${charlie}`,
      )) as any;
      assert.equal(
        charlieStatus.unreadCount,
        0,
        "no scoped unread for charlie",
      );

      // after the scoped round ends, a public round is visible to charlie again
      await apiPost(port, "/api/collect", { session: hostSession });
      await apiPost(port, "/api/raise", { session: alice, weight: 0 });
      await apiPost(port, "/api/raise", { session: bob, weight: 0 });
      await apiPost(port, "/api/raise", { session: charlie, weight: 1 });
      await apiPost(port, "/api/order", {
        session: hostSession,
        order: ["charlie"],
      });
      await apiPost(port, "/api/send", {
        session: charlie,
        content: "public-msg",
      });
      const charlieHist2 = (await apiGet(
        port,
        `/api/history?session=${charlie}`,
      )) as any;
      assert.ok(
        contents(charlieHist2).includes("public-msg"),
        "public round messages are visible to everyone again",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects bad participant lists (empty, host, unknown, offline)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "scope-validate",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      await apiPost(port, "/api/leave", { session: alice });

      assert.equal(
        (
          (await apiPost(port, "/api/collect", {
            session: hostSession,
            participants: [],
          })) as any
        ).error,
        "participants cannot be empty",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/collect", {
            session: hostSession,
            participants: ["host"],
          })) as any
        ).error,
        "Host is implicitly in scope; do not list it in participants",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/collect", {
            session: hostSession,
            participants: ["ghost"],
          })) as any
        ).error,
        "Agent 'ghost' is not in the room",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/collect", {
            session: hostSession,
            participants: ["alice"],
          })) as any
        ).error,
        "Agent 'alice' is not available to participate",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("poll / vote / reveal", () => {
  it("collects private ballots and reveals them all at once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "vote-room",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      const bob = await joinAgent(port, "bob");
      const carol = await joinAgent(port, "carol");

      const poll = (await apiPost(port, "/api/poll", {
        session: hostSession,
        question: "who is eliminated?",
        participants: ["alice", "bob", "carol"],
      })) as any;
      assert.equal(poll.ok, true);
      assert.deepEqual(poll.participants, ["alice", "bob", "carol"]);

      // each voter receives a vote_open event
      for (const [name, s] of [
        ["alice", alice],
        ["bob", bob],
        ["carol", carol],
      ] as const) {
        const heard = (await apiGet(
          port,
          `/api/listen?session=${s}&events=vote_open`,
        )) as any;
        assert.ok(
          Array.isArray(heard) &&
            heard.some((e: any) => e.type === "vote_open" && e.data.question),
          `${name} received vote_open`,
        );
      }

      // cast ballots privately
      for (const [s, choice] of [
        [alice, "bob"],
        [bob, "alice"],
        [carol, "alice"],
      ] as const) {
        const r = (await apiPost(port, "/api/vote", {
          session: s,
          ballot: choice,
        })) as any;
        assert.equal(r.ok, true);
      }

      // before reveal, no agent can see anyone's ballot in history
      const peekBefore = (await apiGet(
        port,
        `/api/history?session=${alice}`,
      )) as any;
      assert.ok(
        !((peekBefore.messages as any[]) ?? [])
          .map((m) => m.content)
          .some((c: string) => c.includes("→") || c.includes("ballot")),
        "ballots are private until reveal",
      );

      // host is told everyone voted
      const hostHeard = (await apiGet(
        port,
        `/api/listen?session=${hostSession}&events=all_voted`,
      )) as any;
      assert.ok(
        Array.isArray(hostHeard) &&
          hostHeard.some((e: any) => e.type === "all_voted"),
        "host receives all_voted",
      );

      // reveal → a single public tally message listing every ballot
      const reveal = (await apiPost(port, "/api/reveal", {
        session: hostSession,
      })) as any;
      assert.equal(reveal.ok, true);

      const carolHist = (await apiGet(
        port,
        `/api/history?session=${carol}`,
      )) as any;
      const tally = (carolHist.messages as any[])
        .map((m) => m.content)
        .find((c: string) => c.includes("who is eliminated?"));
      assert.ok(tally, "revealed tally is a public message");
      assert.ok(tally.includes("alice") && tally.includes("bob"), tally);
      // carol's own choice is in the tally, confirming simultaneity (her ballot
      // was hidden from others until reveal just like theirs was from her)
      assert.ok(tally.includes("carol"), tally);
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects vote/reveal misuse and blocks polls during rounds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "vote-validate",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      await joinAgent(port, "bob");

      // no active poll
      assert.equal(
        (
          (await apiPost(port, "/api/vote", {
            session: alice,
            ballot: "x",
          })) as any
        ).error,
        "No active poll",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/reveal", {
            session: hostSession,
          })) as any
        ).error,
        "No active poll",
      );

      // open a poll, then double-vote / non-voter / host-vote
      await apiPost(port, "/api/poll", {
        session: hostSession,
        question: "q",
        participants: ["alice"],
      });
      assert.equal(
        (
          (await apiPost(port, "/api/vote", {
            session: hostSession,
            ballot: "x",
          })) as any
        ).error,
        "Host does not vote",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/vote", {
            session: "s_bad",
            ballot: "x",
          })) as any
        ).error,
        "Invalid session",
      );
      await apiPost(port, "/api/vote", { session: alice, ballot: "bob" });
      assert.equal(
        (
          (await apiPost(port, "/api/vote", {
            session: alice,
            ballot: "bob",
          })) as any
        ).error,
        "Already voted",
      );
      await apiPost(port, "/api/reveal", { session: hostSession });

      // cannot open a poll while a speaking round is in progress
      await apiPost(port, "/api/collect", { session: hostSession });
      await apiPost(port, "/api/raise", { session: alice, weight: 1 });
      assert.equal(
        (
          (await apiPost(port, "/api/poll", {
            session: hostSession,
            question: "q",
            participants: ["alice"],
          })) as any
        ).error,
        "Round in progress",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("host whisper", () => {
  it("delivers a whisper event to the recipient and shows in their history/unread", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "whisper-room",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");

      const whisper = (await apiPost(port, "/api/whisper", {
        session: hostSession,
        content: "you are the seer",
        to: ["alice"],
      })) as any;
      assert.equal(whisper.ok, true);
      assert.ok(whisper.messageId, "returns a messageId");

      // alice receives a dedicated whisper event
      const heard = (await apiGet(
        port,
        `/api/listen?session=${alice}&events=whisper`,
      )) as any;
      assert.ok(
        Array.isArray(heard) &&
          heard.some(
            (e: any) =>
              e.type === "whisper" &&
              e.data.from === "host" &&
              (e.data.message as any)?.content === "you are the seer",
          ),
        "recipient receives a whisper event from the host",
      );

      // alice's unread reflects it (status is a peek, so check before history)
      const aliceStatus = (await apiGet(
        port,
        `/api/status?session=${alice}`,
      )) as any;
      assert.equal(aliceStatus.unreadCount, 1, "whisper counts as unread");

      // the message is in alice's history (history is the consume action)
      const aliceHist = (await apiGet(
        port,
        `/api/history?session=${alice}`,
      )) as any;
      assert.ok(
        (aliceHist.messages as any[])
          .map((m) => m.content)
          .includes("you are the seer"),
        "whispered message appears in recipient history",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is private: non-recipients see nothing and stay at zero unread", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "whisper-private",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      const bob = await joinAgent(port, "bob");

      await apiPost(port, "/api/whisper", {
        session: hostSession,
        content: "psst alice",
        to: ["alice"],
      });

      // bob's unread stays at zero (peek before any other event)
      const bobStatus = (await apiGet(
        port,
        `/api/status?session=${bob}`,
      )) as any;
      assert.equal(
        bobStatus.unreadCount,
        0,
        "no unread leaks to non-recipient",
      );

      // bob's history must NOT contain the whispered message
      const bobHist = (await apiGet(
        port,
        `/api/history?session=${bob}`,
      )) as any;
      assert.ok(
        !(bobHist.messages as any[])
          .map((m) => m.content)
          .includes("psst alice"),
        "non-recipient cannot see the whispered message",
      );

      // bob gets no whisper event: flush a public message into his queue, then
      // listen for whisper+message together and confirm only the message lands.
      await apiPost(port, "/api/send", {
        session: hostSession,
        content: "public announcement",
      });
      const bobHeard = (await apiGet(
        port,
        `/api/listen?session=${bob}&events=whisper,message`,
      )) as any;
      assert.ok(
        Array.isArray(bobHeard) &&
          bobHeard.some((e: any) => e.type === "message") &&
          !bobHeard.some((e: any) => e.type === "whisper"),
        "non-recipient receives no whisper event",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the host sees its own whispered message in history", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "whisper-host",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");

      const whisper = (await apiPost(port, "/api/whisper", {
        session: hostSession,
        content: "private note",
        to: ["alice"],
      })) as any;

      // status is a peek (does not advance the cursor) — check BEFORE history
      // so this genuinely tests whether whisper advances the sender's cursor.
      const hostStatus = (await apiGet(
        port,
        `/api/status?session=${hostSession}`,
      )) as any;
      assert.equal(
        hostStatus.unreadCount,
        0,
        "host's own whisper is not unread to the host",
      );

      const hostHist = (await apiGet(
        port,
        `/api/history?session=${hostSession}`,
      )) as any;
      const msg = (hostHist.messages as any[]).find(
        (m) => m.id === whisper.messageId,
      );
      assert.ok(msg, "host sees its own whispered message in history");
      assert.equal(msg.speaker, "host");
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-host, missing to, missing content, and offline recipients", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "whisper-validate",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      await joinAgent(port, "bob");

      // non-host session
      assert.equal(
        (
          (await apiPost(port, "/api/whisper", {
            session: alice,
            content: "x",
            to: ["bob"],
          })) as any
        ).error,
        "Only host can perform this action",
      );

      // missing / empty `to`
      assert.equal(
        (
          (await apiPost(port, "/api/whisper", {
            session: hostSession,
            content: "x",
          })) as any
        ).error,
        "to must be a non-empty array of agent names",
      );
      assert.equal(
        (
          (await apiPost(port, "/api/whisper", {
            session: hostSession,
            content: "x",
            to: [],
          })) as any
        ).error,
        "to must be a non-empty array of agent names",
      );

      // missing content
      assert.equal(
        (
          (await apiPost(port, "/api/whisper", {
            session: hostSession,
            to: ["alice"],
          })) as any
        ).error,
        "content is required",
      );

      // unknown agent name
      assert.equal(
        (
          (await apiPost(port, "/api/whisper", {
            session: hostSession,
            content: "x",
            to: ["ghost"],
          })) as any
        ).error,
        "Agent 'ghost' is not online",
      );

      // an agent who went offline
      await apiPost(port, "/api/leave", { session: alice });
      assert.equal(
        (
          (await apiPost(port, "/api/whisper", {
            session: hostSession,
            content: "x",
            to: ["alice"],
          })) as any
        ).error,
        "Agent 'alice' is not online",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("delivers to multiple recipients; a third agent is excluded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "whisper-multi",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");
      const bob = await joinAgent(port, "bob");
      const carol = await joinAgent(port, "carol");

      await apiPost(port, "/api/whisper", {
        session: hostSession,
        content: "wolf team",
        to: ["alice", "bob"],
      });

      // both recipients receive a whisper event
      for (const [name, s] of [
        ["alice", alice],
        ["bob", bob],
      ] as const) {
        const heard = (await apiGet(
          port,
          `/api/listen?session=${s}&events=whisper`,
        )) as any;
        assert.ok(
          Array.isArray(heard) &&
            heard.some(
              (e: any) =>
                e.type === "whisper" &&
                (e.data.message as any)?.content === "wolf team",
            ),
          `${name} receives the whisper event`,
        );
        const hist = (await apiGet(port, `/api/history?session=${s}`)) as any;
        assert.ok(
          (hist.messages as any[]).map((m) => m.content).includes("wolf team"),
          `${name} sees the whisper in history`,
        );
      }

      // carol (a non-recipient) does not see it and has no unread
      const carolHist = (await apiGet(
        port,
        `/api/history?session=${carol}`,
      )) as any;
      assert.ok(
        !(carolHist.messages as any[])
          .map((m) => m.content)
          .includes("wolf team"),
        "non-recipient does not see the whisper",
      );
      const carolStatus = (await apiGet(
        port,
        `/api/status?session=${carol}`,
      )) as any;
      assert.equal(
        carolStatus.unreadCount,
        0,
        "non-recipient stays at 0 unread",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("works while a round is in progress (does not require idle)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "whisper-midround",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");

      // open a round — room is now mid-round (collecting), NOT idle
      const collect = (await apiPost(port, "/api/collect", {
        session: hostSession,
      })) as any;
      assert.equal(collect.ok, true);

      // whisper succeeds even though the room is not idle
      const whisper = (await apiPost(port, "/api/whisper", {
        session: hostSession,
        content: "hang tight",
        to: ["alice"],
      })) as any;
      assert.equal(whisper.ok, true);

      // whisper did not disturb the round state
      const status = (await apiGet(
        port,
        `/api/status?session=${hostSession}`,
      )) as any;
      assert.equal(status.roundState.phase, "collecting");
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("order with a repeated name (host speaks twice)", () => {
  it("gives the repeated speaker one turn per occurrence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    const handle = await startRoom({
      dir,
      roomName: "repeat-order",
      host: { name: "host" },
    });
    const { port, hostSession, stop } = handle;
    try {
      const alice = await joinAgent(port, "alice");

      await apiPost(port, "/api/collect", { session: hostSession });
      await apiPost(port, "/api/raise", { session: alice, weight: 1 });
      // host appears twice — e.g. ask → alice answers → host confirms
      await apiPost(port, "/api/order", {
        session: hostSession,
        order: ["host", "alice", "host"],
      });

      // host's first turn
      let hostTurn = (await apiGet(
        port,
        `/api/listen?session=${hostSession}&events=your_turn`,
      )) as any;
      assert.ok(
        Array.isArray(hostTurn) &&
          hostTurn.some((e: any) => e.type === "your_turn"),
        "host gets its first turn",
      );
      await apiPost(port, "/api/send", { session: hostSession, content: "q?" });

      // alice's turn
      const aliceTurn = (await apiGet(
        port,
        `/api/listen?session=${alice}&events=your_turn`,
      )) as any;
      assert.ok(
        Array.isArray(aliceTurn) &&
          aliceTurn.some((e: any) => e.type === "your_turn"),
        "alice gets a turn",
      );
      await apiPost(port, "/api/send", { session: alice, content: "a" });

      // host's SECOND turn (the repeated occurrence)
      hostTurn = (await apiGet(
        port,
        `/api/listen?session=${hostSession}&events=your_turn`,
      )) as any;
      assert.ok(
        Array.isArray(hostTurn) &&
          hostTurn.some((e: any) => e.type === "your_turn"),
        "host gets a second turn from the repeated name in order",
      );
    } finally {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
