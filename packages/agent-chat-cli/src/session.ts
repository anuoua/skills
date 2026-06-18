import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionInfo {
  port: number;
  agentName: string;
  roomName: string;
}

const SESSION_DIR = join(homedir(), ".agent-chat");
const SESSION_FILE = join(SESSION_DIR, "sessions.json");

function ensureDir() {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function readSessions(): Record<string, SessionInfo> {
  ensureDir();
  if (!existsSync(SESSION_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeSessions(sessions: Record<string, SessionInfo>) {
  ensureDir();
  writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

export function saveSession(sessionId: string, info: SessionInfo) {
  const sessions = readSessions();
  sessions[sessionId] = info;
  writeSessions(sessions);
}

export function getSession(sessionId: string): SessionInfo | null {
  const sessions = readSessions();
  return sessions[sessionId] || null;
}

export function removeSession(sessionId: string) {
  const sessions = readSessions();
  delete sessions[sessionId];
  writeSessions(sessions);
}
