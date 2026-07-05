import { basename } from "node:path";

/** `<room>.<port>.json` — the single file a room server writes to its dir. */
export function roomFileName(roomName: string, port: number): string {
  return `${roomName}.${port}.json`;
}

/**
 * Extract the port from a room file path (`<room>.<port>.json`), e.g.
 * `./test-room.54321.json` → `54321`. Returns null if the name doesn't match.
 */
export function portFromFile(filePath: string): number | null {
  const m = basename(filePath).match(/^.+\.(\d+)\.json$/);
  return m && m[1] !== undefined ? parseInt(m[1], 10) : null;
}

/**
 * Extract the port from a session id of the form `s_<port>_<6hex>`, e.g.
 * `s_54321_a1b2c3` → `54321`. Returns null if the id doesn't match.
 */
export function portFromSession(sessionId: string): number | null {
  const m = sessionId.match(/^s_(\d+)_[0-9a-f]{6}$/);
  return m && m[1] !== undefined ? parseInt(m[1], 10) : null;
}

export function getServerUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}
