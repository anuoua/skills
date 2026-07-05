import express from "express";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
  Message,
  AgentState,
  ChatEvent,
  RoundState,
  ServerConfig,
} from "./types.ts";
import { roomFileName } from "./room.ts";

interface PendingListener {
  agentName: string;
  events: string[];
  res: express.Response;
}

const MAX_QUEUE_SIZE = 1000;

export function createChatRoomServer(config: ServerConfig) {
  const { roomName, port, dir, host } = config;

  const agents = new Map<string, AgentState>();
  const messages: Message[] = [];
  const eventQueues = new Map<string, ChatEvent[]>();
  const pendingListeners: PendingListener[] = [];
  const sessions = new Map<string, string>();
  let isKilled = false;
  let actualPort = port;
  let filePath = "";

  const roundState: RoundState = {
    roundNumber: 0,
    phase: "idle",
    weights: {},
    order: [],
    currentSpeakerIndex: -1,
    decidedAgentNames: [],
    excludedAgentNames: [],
  };

  function ensureQueue(name: string): ChatEvent[] {
    let queue = eventQueues.get(name);
    if (!queue) {
      queue = [];
      eventQueues.set(name, queue);
    }
    return queue;
  }

  function trimQueue(queue: ChatEvent[]) {
    if (queue.length > MAX_QUEUE_SIZE) {
      queue.splice(0, queue.length - MAX_QUEUE_SIZE);
    }
  }

  function enqueueEvent(event: ChatEvent, targetName?: string) {
    if (targetName) {
      const q = ensureQueue(targetName);
      q.push(event);
      trimQueue(q);
      flushPending(targetName);
    } else {
      for (const [name, state] of agents) {
        if (!state.online) continue;
        const q = ensureQueue(name);
        q.push(event);
        trimQueue(q);
      }
      flushPending();
    }
  }

  function flushPending(targetName?: string) {
    for (let i = pendingListeners.length - 1; i >= 0; i--) {
      const pl = pendingListeners[i];
      if (!pl) continue;
      if (targetName && pl.agentName !== targetName) continue;
      const queue = eventQueues.get(pl.agentName) ?? [];
      const matched =
        pl.events.length > 0
          ? queue.filter((e) => pl.events.includes(e.type))
          : [...queue];
      if (matched.length > 0) {
        const remaining =
          pl.events.length > 0
            ? queue.filter((e) => !pl.events.includes(e.type))
            : [];
        eventQueues.set(pl.agentName, remaining);
        pl.res.json(matched);
        pendingListeners.splice(i, 1);
      }
    }
  }

  function resolveAllPendingWithEmpty() {
    for (const pl of pendingListeners) {
      pl.res.json([]);
    }
    pendingListeners.length = 0;
  }

  /** Atomically rewrite the message log to disk (tmp + rename). */
  function persistMessages() {
    if (!filePath) return;
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(messages));
    renameSync(tmp, filePath);
  }

  function addMessage(
    speaker: string,
    content: string,
    type: "message" | "system",
    mention?: string,
  ): Message {
    const msg: Message = {
      id: randomUUID().slice(0, 8),
      speaker,
      content,
      timestamp: Date.now(),
      type,
    };
    if (mention !== undefined) {
      msg.mention = mention;
    }
    messages.push(msg);
    persistMessages();
    return msg;
  }

  /** Push a message event to everyone (and a mention event to the @target). */
  function broadcastMessage(msg: Message, from: string, mention?: string) {
    enqueueEvent({
      type: "message",
      data: { message: msg },
      timestamp: Date.now(),
    });
    if (mention && agents.has(mention)) {
      enqueueEvent(
        {
          type: "mention",
          data: { message: msg, from },
          timestamp: Date.now(),
        },
        mention,
      );
    }
  }

  function unreadSince(agent: AgentState): number {
    return agent.lastReadAt > 0 ? agent.lastReadAt : agent.joinedAt;
  }

  function getHistory(
    name: string,
    limit: number | undefined,
    unreadOnly: boolean,
  ): Message[] {
    let msgs = messages;
    const agent = agents.get(name);
    if (unreadOnly && agent) {
      msgs = msgs.filter((m) => m.timestamp > unreadSince(agent));
    }
    if (limit && limit > 0) {
      msgs = msgs.slice(-limit);
    }
    return msgs;
  }

  function markRead(name: string) {
    const agent = agents.get(name);
    if (agent) agent.lastReadAt = Date.now();
  }

  function getParticipatingAgents(): string[] {
    const names: string[] = [];
    for (const [name, state] of agents) {
      if (
        state.online &&
        !roundState.excludedAgentNames.includes(name) &&
        !state.isHost
      ) {
        names.push(name);
      }
    }
    return names;
  }

  function isEligibleSpeaker(name: string): boolean {
    const agent = agents.get(name);
    if (!agent) return false;
    if (!agent.online) return false;
    if (roundState.excludedAgentNames.includes(name)) return false;
    return true;
  }

  function checkAllDecided() {
    if (roundState.phase !== "collecting") return;
    const participating = getParticipatingAgents();
    const allDecided = participating.every((name) =>
      roundState.decidedAgentNames.includes(name),
    );
    if (allDecided) {
      roundState.phase = "ordering";
      const event: ChatEvent = {
        type: "all_decided",
        data: {
          weights: { ...roundState.weights },
          roundNumber: roundState.roundNumber,
        },
        timestamp: Date.now(),
      };
      const host = getHost();
      if (host) enqueueEvent(event, host.name);
    }
  }

  function getHost(): AgentState | undefined {
    for (const [, state] of agents) {
      if (state.isHost) return state;
    }
    return undefined;
  }

  function advanceSpeaker() {
    roundState.currentSpeakerIndex++;
    while (roundState.currentSpeakerIndex < roundState.order.length) {
      const nextSpeaker = roundState.order[roundState.currentSpeakerIndex];
      if (nextSpeaker && isEligibleSpeaker(nextSpeaker)) {
        enqueueEvent(
          {
            type: "your_turn",
            data: {
              agentName: nextSpeaker,
              roundNumber: roundState.roundNumber,
            },
            timestamp: Date.now(),
          },
          nextSpeaker,
        );
        return;
      }
      roundState.currentSpeakerIndex++;
    }
    roundDone();
  }

  function roundDone() {
    roundState.phase = "idle";
    roundState.decidedAgentNames = [];
    roundState.weights = {};
    roundState.order = [];
    roundState.currentSpeakerIndex = -1;
    roundState.roundNumber++;
    const host = getHost();
    if (host)
      enqueueEvent(
        {
          type: "round_done",
          data: { roundNumber: roundState.roundNumber - 1 },
          timestamp: Date.now(),
        },
        host.name,
      );
  }

  /** Session ids encode the port so the CLI can dial back in: `s_<port>_<6hex>`. */
  function generateSessionId(): string {
    const hex = randomUUID().replace(/-/g, "").slice(0, 6);
    return `s_${actualPort}_${hex}`;
  }

  function resolveSession(session: string): string | null {
    return sessions.get(session) ?? null;
  }

  function requireHostBySession(
    session: string,
    res: express.Response,
  ): boolean {
    const name = resolveSession(session);
    if (!name) {
      res.status(401).json({ error: "Invalid session" });
      return false;
    }
    const agent = agents.get(name);
    if (!agent || !agent.isHost) {
      res.status(403).json({ error: "Only host can perform this action" });
      return false;
    }
    return true;
  }

  const app = express();
  app.use(express.json());

  app.post("/api/join", (req, res) => {
    const { name, description } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    // The host is established at serve time; nobody may join under its name.
    const reserved = agents.get(name);
    if (reserved?.isHost) {
      res.status(400).json({ error: "Name is reserved by the host" });
      return;
    }

    const now = Date.now();
    const existing = agents.get(name);
    if (existing) {
      existing.online = true;
      existing.lastReadAt = 0;
    } else {
      agents.set(name, {
        name,
        description,
        isHost: false,
        online: true,
        joinedAt: now,
        lastReadAt: 0,
      });
    }

    const sessionId = generateSessionId();
    sessions.set(sessionId, name);
    enqueueEvent({
      type: "agent_joined",
      data: { agentName: name, isHost: false },
      timestamp: Date.now(),
    });
    res.json({ ok: true, isHost: false, session: sessionId });
  });

  app.post("/api/leave", (req, res) => {
    const name = resolveSession(req.body?.session);
    if (!name) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    const agent = agents.get(name);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    if (agent.isHost) {
      res.status(403).json({ error: "Host cannot leave, use kill instead" });
      return;
    }

    agent.online = false;
    if (!roundState.excludedAgentNames.includes(name))
      roundState.excludedAgentNames.push(name);
    for (const [sid, agentName] of sessions) {
      if (agentName === name) sessions.delete(sid);
    }
    enqueueEvent({
      type: "agent_left",
      data: { agentName: name, reason: "left" },
      timestamp: Date.now(),
    });
    checkAllDecided();
    if (
      roundState.phase === "speaking" &&
      roundState.order[roundState.currentSpeakerIndex] === name
    )
      advanceSpeaker();
    res.json({ ok: true });
  });

  app.post("/api/send", (req, res) => {
    const name = resolveSession(req.body?.session);
    if (!name) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }
    const agent = agents.get(name);
    if (!agent || !agent.online) {
      res.status(403).json({ error: "Agent is offline" });
      return;
    }

    const { content, mention } = req.body ?? {};
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    // The host may speak freely between rounds (opening/closing remarks) while
    // the room is idle; this does not advance any turn. Otherwise a message may
    // only come from the current speaker during the speaking phase.
    const hostFreeSpeak = agent.isHost && roundState.phase === "idle";
    if (!hostFreeSpeak) {
      if (roundState.phase !== "speaking") {
        res.status(400).json({ error: "Not in speaking phase" });
        return;
      }
      if (roundState.order[roundState.currentSpeakerIndex] !== name) {
        res.status(400).json({ error: "Not your turn" });
        return;
      }
    }

    const msg = addMessage(name, content, "message", mention);
    // A sender has already seen their own message — advance their read cursor
    // past it so it doesn't show as unread to them.
    agent.lastReadAt = msg.timestamp;
    broadcastMessage(msg, name, mention);
    if (!hostFreeSpeak) advanceSpeaker();
    res.json({ ok: true, messageId: msg.id });
  });

  app.post("/api/raise", (req, res) => {
    const name = resolveSession(req.body?.session);
    if (!name) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }
    const agent = agents.get(name);
    if (!agent || !agent.online) {
      res.status(403).json({ error: "Agent is offline" });
      return;
    }
    if (agent.isHost) {
      res.status(400).json({ error: "Host does not raise" });
      return;
    }
    if (roundState.phase !== "collecting") {
      res.status(400).json({ error: "Not in collecting phase" });
      return;
    }
    if (roundState.decidedAgentNames.includes(name)) {
      res.status(400).json({ error: "Already decided" });
      return;
    }

    const weight = req.body?.weight;
    if (
      typeof weight !== "number" ||
      !Number.isFinite(weight) ||
      !Number.isInteger(weight) ||
      weight < 0 ||
      weight > 10
    ) {
      res
        .status(400)
        .json({ error: "weight must be an integer between 0 and 10" });
      return;
    }

    roundState.weights[name] = weight;
    roundState.decidedAgentNames.push(name);
    checkAllDecided();
    res.json({ ok: true });
  });

  app.post("/api/collect", (req, res) => {
    if (!requireHostBySession(req.body?.session, res)) return;
    if (roundState.phase !== "idle") {
      res.status(400).json({ error: "Round already in progress" });
      return;
    }

    roundState.phase = "collecting";
    roundState.decidedAgentNames = [];
    roundState.weights = {};
    roundState.excludedAgentNames = roundState.excludedAgentNames.filter(
      (n) => {
        const a = agents.get(n);
        return !!a && !a.online;
      },
    );

    const participating = getParticipatingAgents();
    if (participating.length === 0) {
      roundState.phase = "idle";
      res.status(400).json({ error: "No participating agents" });
      return;
    }

    for (const name of participating) {
      enqueueEvent(
        {
          type: "collect",
          data: { roundNumber: roundState.roundNumber },
          timestamp: Date.now(),
        },
        name,
      );
    }

    res.json({
      ok: true,
      roundNumber: roundState.roundNumber,
      participants: participating,
    });
  });

  app.post("/api/order", (req, res) => {
    if (!requireHostBySession(req.body?.session, res)) return;

    const order = req.body?.order;
    if (!Array.isArray(order) || order.length === 0) {
      res.status(400).json({ error: "order array is required" });
      return;
    }
    if (roundState.phase !== "ordering") {
      res.status(400).json({ error: "Not in ordering phase" });
      return;
    }

    for (const n of order) {
      if (typeof n !== "string") {
        res.status(400).json({ error: "order must contain strings" });
        return;
      }
      if (!isEligibleSpeaker(n)) {
        res
          .status(400)
          .json({ error: `Agent '${n}' is not available to speak` });
        return;
      }
    }

    roundState.order = order;
    roundState.currentSpeakerIndex = -1;
    roundState.phase = "speaking";
    advanceSpeaker();
    res.json({ ok: true, order });
  });

  app.post("/api/kill", (req, res) => {
    if (!requireHostBySession(req.body?.session, res)) return;

    isKilled = true;

    enqueueEvent({ type: "killed", data: { roomName }, timestamp: Date.now() });
    res.json({ ok: true });

    const srv = server;
    if (srv)
      setTimeout(() => {
        srv.close(() => {});
      }, 100);
  });

  app.get("/api/status", (req, res) => {
    const name = resolveSession(req.query.session as string);
    if (!name) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    const msgs = messages;
    const agent = agents.get(name);
    const since = agent ? unreadSince(agent) : 0;
    const unreadMsgs = agent ? msgs.filter((m) => m.timestamp > since) : [];
    const myMentions = unreadMsgs.filter((m) => m.mention === name);

    // status is a pure peek — it reports unread state but does NOT advance the
    // read cursor. Only `history` marks messages read.
    res.json({
      roomName,
      host: getHost()?.name || null,
      onlineAgents: Array.from(agents.values())
        .filter((a) => a.online)
        .map((a) => ({
          name: a.name,
          isHost: a.isHost,
          description: a.description,
        })),
      roundState: {
        roundNumber: roundState.roundNumber,
        phase: roundState.phase,
      },
      unreadCount: unreadMsgs.length,
      mentions: myMentions.length,
      mentionMessages: myMentions.slice(-5),
      isKilled,
    });
  });

  app.get("/api/history", (req, res) => {
    const name = resolveSession(req.query.session as string);
    if (!name) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    const limit = parseInt((req.query.limit as string) || "50", 10);
    const unreadOnly = req.query.unreadOnly === "true";

    const msgs = getHistory(
      name,
      Number.isFinite(limit) ? limit : undefined,
      unreadOnly,
    );
    markRead(name);
    res.json({ messages: msgs });
  });

  app.get("/api/agents", (_req, res) => {
    const agentList = Array.from(agents.values())
      .filter((a) => a.online)
      .map((a) => ({
        name: a.name,
        isHost: a.isHost,
        description: a.description,
      }));
    res.json({ agents: agentList });
  });

  app.get("/api/listen", (req, res) => {
    const agentName = resolveSession(req.query.session as string);
    if (!agentName) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }

    const eventsParam = (req.query.events as string) || "";
    const eventTypes = eventsParam
      ? eventsParam.split(",").map((s) => s.trim())
      : [];
    const queue = ensureQueue(agentName);
    const matched =
      eventTypes.length > 0
        ? queue.filter((e) => eventTypes.includes(e.type))
        : [...queue];

    if (matched.length > 0) {
      const remaining =
        eventTypes.length > 0
          ? queue.filter((e) => !eventTypes.includes(e.type))
          : [];
      eventQueues.set(agentName, remaining);
      res.json(matched);
      return;
    }

    // Drop the pending listener if the client disconnects while waiting, so we
    // don't keep the entry around or write to a closed socket later.
    res.on("close", () => {
      const idx = pendingListeners.findIndex((pl) => pl.res === res);
      if (idx !== -1) {
        pendingListeners.splice(idx, 1);
      }
    });

    pendingListeners.push({ agentName, events: eventTypes, res });
  });

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    get port() {
      return actualPort;
    },
    get filePath() {
      return filePath;
    },
    async start() {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // Establish the host up front (it never joins via the API).
      if (host) {
        const hostAgent: AgentState = {
          name: host.name,
          isHost: true,
          online: true,
          joinedAt: Date.now(),
          lastReadAt: 0,
        };
        if (host.description !== undefined)
          hostAgent.description = host.description;
        agents.set(host.name, hostAgent);
        sessions.set(host.session, host.name);
      }
      return new Promise<void>((resolve, reject) => {
        server = app.listen(port, "127.0.0.1", () => {
          const addr = server!.address();
          actualPort = typeof addr === "object" && addr ? addr.port : port;
          filePath = join(dir, roomFileName(roomName, actualPort));
          writeFileSync(filePath, "[]");
          resolve();
        });
        server.on("error", reject);
      });
    },
    async stop() {
      resolveAllPendingWithEmpty();
      if (!server) return;
      const srv = server;
      return new Promise<void>((resolve) => srv.close(() => resolve()));
    },
  };
}
