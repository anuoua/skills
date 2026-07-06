import type { Message, ChatEvent } from "./types.ts";

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Indent every line of `text` by two spaces (preserves blank lines). */
function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.length ? "  " + l : "  "))
    .join("\n");
}

function truncate(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/** A single message: header line + indented content block. */
export function fmtMessage(msg: Message): string {
  const at = msg.mention ? ` @${msg.mention}` : "";
  return `[${fmtTime(msg.timestamp)}] ${msg.speaker}${at}:\n${indent(msg.content)}`;
}

export function fmtServe(r: {
  port: number;
  room: string;
  file: string;
  session: string;
}): string {
  return [
    `Room '${r.room}' started on port ${r.port} (detached)`,
    `File: ${r.file}`,
    `Host session: ${r.session}`,
  ].join("\n");
}

export function fmtJoin(name: string, session: string): string {
  return `Joined as ${name}\nSession: ${session}`;
}

export function fmtSend(messageId: string): string {
  return `Sent [${messageId}]`;
}

export function fmtRaise(weight: number): string {
  return `Raised (weight ${weight})`;
}

export function fmtCollect(r: {
  roundNumber: number;
  participants: string[];
}): string {
  return `Round ${r.roundNumber} opened · waiting on: ${r.participants.join(", ") || "(none)"}`;
}

export function fmtOrder(order: string[]): string {
  return `Order: ${order.join(" → ")}`;
}

interface AgentView {
  name: string;
  isHost?: boolean;
  description?: string;
}

export function fmtAgents(agents: AgentView[]): string {
  if (agents.length === 0) return "(no agents)";
  return agents
    .map((a) => {
      let line = a.name;
      if (a.isHost) line += " (host)";
      if (a.description) line += `  ${a.description}`;
      return line;
    })
    .join("\n");
}

interface StatusView {
  roomName: string;
  host: string | null;
  onlineAgents: AgentView[];
  roundState: { roundNumber: number; phase: string };
  unreadCount: number;
  mentions: number;
  mentionMessages?: Message[];
  isKilled?: boolean;
}

export function fmtStatus(r: StatusView): string {
  const lines: string[] = [];
  lines.push(
    `${r.roomName} · round ${r.roundState.roundNumber} · ${r.roundState.phase}`,
  );
  lines.push(`Host: ${r.host ?? "(none)"}`);
  const online = r.onlineAgents.map((a) => a.name).join(", ");
  lines.push(`Online: ${online || "(none)"}`);
  const msgWord = r.unreadCount === 1 ? "message" : "messages";
  const mentionWord = r.mentions === 1 ? "mention" : "mentions";
  lines.push(
    `Unread: ${r.unreadCount} ${msgWord} · ${r.mentions} ${mentionWord}`,
  );
  for (const m of r.mentionMessages ?? []) {
    lines.push(`  ← ${m.speaker}: ${truncate(m.content)}`);
  }
  if (r.isKilled) lines.push("(room killed)");
  return lines.join("\n");
}

export function fmtHistory(messages: Message[]): string {
  if (messages.length === 0) return "(no messages)";
  return messages.map(fmtMessage).join("\n\n");
}

export function fmtEvent(ev: ChatEvent): string {
  const t = fmtTime(ev.timestamp);
  const d = ev.data as Record<string, unknown>;
  switch (ev.type) {
    case "message":
      return fmtMessage(d.message as Message);
    case "mention":
      return `[${t}] @you mentioned by ${d.from}:\n${indent((d.message as Message)?.content ?? "")}`;
    case "collect":
      return `[${t}] collect  (round ${d.roundNumber})`;
    case "your_turn":
      return `[${t}] your_turn  (round ${d.roundNumber})`;
    case "all_decided": {
      const weights = d.weights as Record<string, number> | undefined;
      const w = weights
        ? Object.entries(weights)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : "";
      return `[${t}] all_decided  weights: ${w || "(none)"}`;
    }
    case "round_done":
      return `[${t}] round_done  (round ${d.roundNumber} finished)`;
    case "presence":
      return `[${t}] ${d.kind === "left" ? "-" : "+"} ${d.agentName} ${d.kind}`;
    case "killed":
      return `[${t}] room killed`;
    default:
      return `[${t}] ${ev.type}`;
  }
}

export function fmtEvents(events: ChatEvent[]): string {
  if (events.length === 0) return "(no events)";
  return events.map(fmtEvent).join("\n\n");
}

/**
 * Agent-friendly action prompt for `wait`. Tells the agent exactly which
 * command to run next (with the session pre-filled), or notes terminal state.
 */
export function fmtWaitPrompt(ev: ChatEvent, session: string): string {
  const d = ev.data as Record<string, unknown>;
  switch (ev.type) {
    case "collect":
      return [
        `Round ${d.roundNumber} opened — raise your hand or skip.`,
        `  Run: agent-chat raise --session ${session} --weight <n>`,
        `  (0 = skip this round; 1-10 = speaking priority)`,
      ].join("\n");
    case "your_turn":
      return [
        `Your turn to speak (round ${d.roundNumber}).`,
        `  Run: agent-chat send --session ${session} --content <text>`,
        `  (optional --mention <agent>)`,
      ].join("\n");
    case "all_decided": {
      const weights = d.weights as Record<string, number> | undefined;
      const w = weights
        ? Object.entries(weights)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
        : "(none)";
      return [
        `All agents decided (round ${d.roundNumber}). Set the speaking order.`,
        `  Weights: ${w}`,
        `  Run: agent-chat order --session ${session} --order <name1> <name2> ...`,
      ].join("\n");
    }
    case "round_done":
      return [
        `Round ${d.roundNumber} finished. Start the next round or terminate.`,
        `  Next: agent-chat collect --session ${session}`,
        `  Or:   agent-chat kill --session ${session}`,
      ].join("\n");
    case "presence":
      return `[${fmtTime(ev.timestamp)}] ${d.kind === "left" ? "-" : "+"} ${d.agentName} ${d.kind}`;
    case "killed":
      return `The room was terminated.`;
    default:
      return fmtEvent(ev);
  }
}
