import { readdirSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

const BASE_DIR = join(homedir(), ".agent-chat");
const ROOMS_DIR = join(BASE_DIR, "rooms");
const DATA_DIR = join(BASE_DIR, "data");

export function getRoomsDir(): string {
  return ROOMS_DIR;
}

export function getDataDir(): string {
  return DATA_DIR;
}

export function ensureBaseDirs(): void {
  for (const dir of [BASE_DIR, ROOMS_DIR, DATA_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function getServerUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function markerFileName(roomName: string, port: number): string {
  return `${roomName}.${port}.json`;
}

export function dbFileName(roomName: string): string {
  return `${roomName}.json`;
}

export function isPortAlive(
  port: number,
  host = "127.0.0.1",
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 300);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function listRoomNamesIn(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Find a live room server by name. Scans the rooms directory for marker files,
 * validates each candidate is actually listening, prunes stale markers, and
 * returns the first live one. Accepts an optional override dir for tests.
 */
export async function findRoomFile(
  roomName: string,
  dir: string = ROOMS_DIR,
): Promise<{ port: number; filePath: string } | null> {
  const escapedName = roomName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedName}\\.(\\d+)\\.json$`);
  const files = listRoomNamesIn(dir);
  const candidates: { port: number; filePath: string }[] = [];
  for (const file of files) {
    const match = file.match(pattern);
    if (match && match[1] !== undefined) {
      candidates.push({
        port: parseInt(match[1], 10),
        filePath: join(dir, file),
      });
    }
  }
  candidates.sort((a, b) => a.port - b.port);
  for (const candidate of candidates) {
    if (await isPortAlive(candidate.port)) {
      return candidate;
    }
    try {
      unlinkSync(candidate.filePath);
    } catch {
      // ignore cleanup errors
    }
  }
  return null;
}
