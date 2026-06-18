import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createChatRoomServer } from "../src/server.ts";
import { findRoomFile, markerFileName, dbFileName } from "../src/room.ts";
import { apiPost, apiGet } from "../src/client.ts";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface RoomHandle {
  room: ReturnType<typeof createChatRoomServer>;
  port: number;
  stop: () => Promise<void>;
}

async function startRoom(opts: {
  roomName?: string;
  dbPath: string;
  markerDir: string;
}): Promise<RoomHandle> {
  const room = createChatRoomServer({
    roomName: opts.roomName ?? "test-room",
    port: 0,
    dbPath: opts.dbPath,
    markerDir: opts.markerDir,
  });
  await room.start();
  const port = room.port;
  return {
    room,
    port,
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

describe("room discovery", () => {
  const markerDir = mkdtempSync(join(tmpdir(), "agent-chat-marker-"));

  after(() => {
    rmSync(markerDir, { recursive: true, force: true });
  });

  it("markerFileName formats correctly", () => {
    assert.equal(markerFileName("test", 8080), "test.8080.json");
    assert.equal(markerFileName("游戏讨论", 38945), "游戏讨论.38945.json");
  });

  it("dbFileName formats correctly", () => {
    assert.equal(dbFileName("test"), "test.json");
  });

  it("returns null when no marker exists", async () => {
    const result = await findRoomFile("nonexistent", markerDir);
    assert.equal(result, null);
  });

  it("finds a live room by marker and prunes stale ones", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "ac-")), "live.json");
    const handle = await startRoom({
      roomName: "live-room",
      dbPath,
      markerDir,
    });
    try {
      const result = await findRoomFile("live-room", markerDir);
      assert.ok(result, "expected to find live room");
      assert.equal(result!.port, handle.port);
    } finally {
      await handle.stop();
    }
    // marker should be removed on stop
    const after = await findRoomFile("live-room", markerDir);
    assert.equal(after, null);
  });
});

describe("chat room server with session", () => {
  let port = 0;
  let hostSession = "";
  let aliceSession = "";
  let bobSession = "";
  const dbPath = join(mkdtempSync(join(tmpdir(), "ac-")), "main.json");
  const markerDir = mkdtempSync(join(tmpdir(), "ac-marker-"));
  let room: ReturnType<typeof createChatRoomServer>;

  before(async () => {
    const handle = await startRoom({ dbPath, markerDir });
    room = handle.room;
    port = handle.port;
  });

  after(async () => {
    await room.stop();
    rmSync(markerDir, { recursive: true, force: true });
  });

  it("join: first agent becomes host and gets session", async () => {
    const result = (await apiPost(port, "/api/join", {
      name: "host",
      description: "主持",
    })) as any;
    assert.equal(result.ok, true);
    assert.equal(result.isHost, true);
    assert.ok(typeof result.session === "string");
    assert.ok(result.session.startsWith("s_"));
    hostSession = result.session;
  });

  it("join: subsequent agents get session", async () => {
    const result = (await apiPost(port, "/api/join", {
      name: "alice",
      description: "分析",
    })) as any;
    assert.equal(result.ok, true);
    assert.equal(result.isHost, false);
    aliceSession = result.session;
  });

  it("join: third agent", async () => {
    const result = (await apiPost(port, "/api/join", { name: "bob" })) as any;
    bobSession = result.session;
  });

  it("agents: list online agents", async () => {
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

  it("kill: host can kill the room", async () => {
    const result = (await apiPost(port, "/api/kill", {
      session: hostSession,
    })) as any;
    assert.equal(result.ok, true);
  });
});

describe("offline agent is skipped in speaking order (Issue 7)", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "ac-")), "skip.json");
  const markerDir = mkdtempSync(join(tmpdir(), "ac-marker-"));

  after(() => {
    rmSync(markerDir, { recursive: true, force: true });
  });

  it("advances past an agent who left mid-order", async () => {
    const handle = await startRoom({
      dbPath,
      markerDir,
      roomName: "skip-room",
    });
    const { port, stop } = handle;
    try {
      const host = await joinAgent(port, "host", "主持");
      const a = await joinAgent(port, "a");
      const b = await joinAgent(port, "b");
      const c = await joinAgent(port, "c");

      await apiPost(port, "/api/collect", { session: host });
      await apiPost(port, "/api/raise", { session: a, weight: 1 });
      await apiPost(port, "/api/raise", { session: b, weight: 1 });
      await apiPost(port, "/api/raise", { session: c, weight: 1 });

      // all three are online and participating when order is set
      const orderResult = (await apiPost(port, "/api/order", {
        session: host,
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

      const status = (await apiGet(port, `/api/status?session=${host}`)) as any;
      assert.equal(status.roundState.phase, "idle");
    } finally {
      await stop();
    }
  });
});

describe("unread tracking via lastReadAt (Issue 11)", () => {
  it("counts unread only for messages after last read", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "ac-")), "unread.json");
    const markerDir = mkdtempSync(join(tmpdir(), "ac-marker-"));
    const handle = await startRoom({
      dbPath,
      markerDir,
      roomName: "unread-room",
    });
    const { port, stop } = handle;
    // host is the reader; bob is the sole speaker (messages only exist inside rounds)
    const speak = async (content: string) => {
      await apiPost(port, "/api/collect", { session: host });
      await apiPost(port, "/api/raise", { session: bob, weight: 1 });
      await apiPost(port, "/api/order", { session: host, order: ["bob"] });
      await apiPost(port, "/api/send", { session: bob, content });
    };
    let host = "";
    let bob = "";
    try {
      host = await joinAgent(port, "host");
      bob = await joinAgent(port, "bob");

      await speak("msg1");
      // host reads -> marks lastReadAt
      await apiGet(port, `/api/status?session=${host}`);

      await speak("msg2");

      const beforeRead = (await apiGet(
        port,
        `/api/status?session=${host}`,
      )) as any;
      assert.equal(beforeRead.unreadCount, 1, "only msg2 is unread");

      // reading again clears it
      const afterRead = (await apiGet(
        port,
        `/api/status?session=${host}`,
      )) as any;
      assert.equal(afterRead.unreadCount, 0);
    } finally {
      await stop();
      rmSync(markerDir, { recursive: true, force: true });
    }
  });
});

describe("persistence across restart (Issue 12)", () => {
  it("preserves messages and host roster identity", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "ac-")), "persist.json");
    const markerDir = mkdtempSync(join(tmpdir(), "ac-marker-"));
    const handle1 = await startRoom({
      dbPath,
      markerDir,
      roomName: "persist-room",
    });
    const port1 = handle1.port;
    const host = await joinAgent(port1, "leader");
    const bob = await joinAgent(port1, "bob");
    // produce a message via a real round (no free messages)
    await apiPost(port1, "/api/collect", { session: host });
    await apiPost(port1, "/api/raise", { session: bob, weight: 1 });
    await apiPost(port1, "/api/order", { session: host, order: ["bob"] });
    await apiPost(port1, "/api/send", { session: bob, content: "remember me" });
    await handle1.stop();

    assert.ok(existsSync(dbPath), "db file should exist");

    const handle2 = await startRoom({
      dbPath,
      markerDir,
      roomName: "persist-room",
    });
    const port2 = handle2.port;
    try {
      // same name rejoins -> should retain host identity from roster
      const rejoin = (await apiPost(port2, "/api/join", {
        name: "leader",
      })) as any;
      assert.equal(
        rejoin.isHost,
        true,
        "host identity should persist across restart",
      );

      const history = (await apiGet(
        port2,
        `/api/history?session=${rejoin.session}`,
      )) as any;
      assert.ok(
        history.messages.some((m: any) => m.content === "remember me"),
        "messages should survive restart",
      );
    } finally {
      await handle2.stop();
      rmSync(markerDir, { recursive: true, force: true });
    }
  });
});
