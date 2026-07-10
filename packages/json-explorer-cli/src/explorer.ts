import * as fs from "node:fs";
import * as path from "node:path";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Entry {
  key: string;
  type: string;
  preview: string;
}

export function isUrlSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

export async function loadJSON(source: string): Promise<JsonValue> {
  const text = isUrlSource(source)
    ? await fetchText(source)
    : fs.readFileSync(path.resolve(source), "utf-8");
  return JSON.parse(text);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export function parsePath(pathStr: string): string[] {
  const s = pathStr.trim();
  if (s === "") return [];
  const segments: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ".") {
      i++;
      continue;
    }
    if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end === -1) {
        throw new Error(`Unclosed "[" in path: "${pathStr}"`);
      }
      let content = s.slice(i + 1, end).trim();
      if (
        content.length >= 2 &&
        ((content[0] === '"' && content[content.length - 1] === '"') ||
          (content[0] === "'" && content[content.length - 1] === "'"))
      ) {
        content = content.slice(1, -1);
      }
      segments.push(content);
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    segments.push(s.slice(i, j));
    i = j;
  }
  return segments;
}

export function navigate(data: JsonValue, pathStr: string): JsonValue {
  if (!pathStr) return data;
  const parts = parsePath(pathStr);
  let current: JsonValue = data;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      throw new Error(
        `Cannot access "${part}" — current value is ${typeof current}`,
      );
    }
    if (Array.isArray(current)) {
      const idx = Number.parseInt(part, 10);
      if (Number.isNaN(idx)) {
        throw new Error(`Expected array index, got "${part}"`);
      }
      const val = current[idx];
      if (val === undefined) {
        throw new Error(`Index ${idx} is out of bounds`);
      }
      current = val;
    } else {
      const val = current[part];
      if (val === undefined) {
        throw new Error(`Key "${part}" not found`);
      }
      current = val;
    }
  }
  return current;
}

export function entries(
  data: JsonValue,
  opts?: { maxLen?: number },
): Entry[] {
  const maxLen = opts?.maxLen ?? 40;
  if (data === null || typeof data !== "object") {
    return [
      {
        key: "(value)",
        type: typeLabel(data),
        preview: formatPreview(data, maxLen),
      },
    ];
  }
  if (Array.isArray(data)) {
    return data.map((item, i) => ({
      key: String(i),
      type: typeLabel(item),
      preview: formatPreview(item, maxLen),
    }));
  }
  return Object.keys(data).map((key) => {
    const val = data[key]!;
    return {
      key,
      type: typeLabel(val),
      preview: formatPreview(val, maxLen),
    };
  });
}

export interface SearchResult {
  path: string;
  key: string;
  matched: "key" | "value";
  type: string;
  preview: string;
}

export function search(data: JsonValue, query: string): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];
  walk(data, "", undefined);
  return results;

  function walk(node: JsonValue, path: string, key: string | undefined) {
    if (key !== undefined) {
      if (key.toLowerCase().includes(q)) {
        results.push({
          path,
          key,
          matched: "key",
          type: typeLabel(node),
          preview: formatPreview(node),
        });
      } else if (isScalar(node) && scalarStr(node).toLowerCase().includes(q)) {
        results.push({
          path,
          key,
          matched: "value",
          type: typeLabel(node),
          preview: formatPreview(node),
        });
      }
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) =>
        walk(item, path === "" ? `[${i}]` : `${path}[${i}]`, String(i)),
      );
    } else if (node !== null && typeof node === "object") {
      for (const k of Object.keys(node)) {
        const childPath = path === "" ? k : `${path}.${k}`;
        walk(node[k]!, childPath, k);
      }
    }
  }
}

function isScalar(v: JsonValue): boolean {
  return v === null || typeof v !== "object";
}

function scalarStr(v: JsonValue): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return String(v);
}

function typeLabel(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === "object") return "object";
  return typeof value;
}

export function formatPreview(value: JsonValue, maxLen = 40): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    const s =
      value.length > maxLen ? value.slice(0, maxLen) + "..." : value;
    return JSON.stringify(s);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `array[${value.length}]`;
  }
  const keys = Object.keys(value);
  return `object{${keys.length}}`;
}