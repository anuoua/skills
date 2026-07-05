import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OpenAPISpec } from "../types.ts";

export async function loadSpec(source: string): Promise<OpenAPISpec> {
  const isUrl = /^https?:\/\//i.test(source);
  let raw: string;

  if (isUrl) {
    const res = await fetch(source, {
      headers: { Accept: "application/json, text/plain" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source}`);
    raw = await res.text();
  } else {
    raw = await readFile(resolve(source), "utf-8");
  }

  const data = JSON.parse(raw) as OpenAPISpec;
  if (!data.openapi && !data.swagger)
    throw new Error("Not a valid OpenAPI/Swagger spec.");
  if (!data.info) throw new Error("Invalid spec: missing 'info' field.");
  data.info.title = data.info.title || "Untitled API";
  data.info.version = data.info.version || "0.0.0";
  data.paths = data.paths || {};
  return data;
}

export function getServerUrl(spec: OpenAPISpec): string {
  if (spec.servers?.length) {
    let url = spec.servers[0]!.url;
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }
  if (spec.host)
    return `${spec.schemes?.[0] || "https"}://${spec.host}${spec.basePath || ""}`;
  return "";
}
