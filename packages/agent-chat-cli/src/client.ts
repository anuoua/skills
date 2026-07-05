import { getServerUrl } from "./room.ts";

export async function apiPost(
  port: number,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${getServerUrl(port)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function apiGet(
  port: number,
  path: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${getServerUrl(port)}${path}`);
  return parseJson(res);
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok && !data.error) {
    data.error = `HTTP ${res.status}`;
  }
  return data;
}
