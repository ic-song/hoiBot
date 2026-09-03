import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { extractHttpRouteSurface, HTTP_ROUTE_MODULE_SPECS, type HttpRouteMethod } from "../src/data-migration/http-route-surface-audit.js";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const METHODS = new Set<HttpRouteMethod>(["GET", "POST", "PATCH", "PUT", "DELETE"]);

interface OracleResult {
  keys: string[];
  duplicateKeys: string[];
  dynamicCount: number;
}

function maskComments(source: string): string {
  let result = "";
  let state: "code" | "single" | "double" | "template" | "line" | "block" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n") { state = "code"; result += char; } else result += " ";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") { result += "  "; index += 1; state = "code"; }
      else result += char === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "code" && char === "/" && next === "/") { result += "  "; index += 1; state = "line"; continue; }
    if (state === "code" && char === "/" && next === "*") { result += "  "; index += 1; state = "block"; continue; }
    result += char;
    if (state === "code" && (char === "'" || char === "\"" || char === "`")) state = char === "'" ? "single" : char === "\"" ? "double" : "template";
    else if (state !== "code" && char === "\\") {
      if (index + 1 < source.length) { result += source[index + 1]!; index += 1; }
    } else if ((state === "single" && char === "'") || (state === "double" && char === "\"") || (state === "template" && char === "`")) state = "code";
  }
  return result;
}

function skipSpace(source: string, start: number): number {
  let cursor = start;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function findCallOpen(source: string, start: number): number {
  let cursor = skipSpace(source, start);
  if (source[cursor] !== "<") return source[cursor] === "(" ? cursor : -1;
  let depth = 0;
  let quote = "";
  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor]!;
    if (quote !== "") {
      if (char === "\\") cursor += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === "\"") { quote = char; continue; }
    if (char === "<") depth += 1;
    else if (char === ">") { depth -= 1; if (depth === 0) return skipSpace(source, cursor + 1) < source.length && source[skipSpace(source, cursor + 1)] === "(" ? skipSpace(source, cursor + 1) : -1; }
  }
  return -1;
}

function readQuoted(source: string, start: number): { value: string; end: number } | undefined {
  const cursor = skipSpace(source, start);
  const quote = source[cursor];
  if (quote !== "'" && quote !== "\"" && quote !== "`") return undefined;
  let value = "";
  for (let index = cursor + 1; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "\\") { value += char + (source[index + 1] ?? ""); index += 1; continue; }
    if (char === quote) return { value, end: index + 1 };
    if (quote === "`" && char === "$" && source[index + 1] === "{") return undefined;
    value += char;
  }
  return undefined;
}

function rawOracle(): OracleResult {
  const keys: string[] = [];
  let dynamicCount = 0;
  for (const spec of HTTP_ROUTE_MODULE_SPECS) {
    const source = maskComments(readFileSync(resolve(runtimeRoot, spec.module), "utf8"));
    const direct = /\bapp\.(get|post|patch|put|delete)\b/g;
    for (const match of source.matchAll(direct)) {
      const open = findCallOpen(source, match.index + match[0].length);
      const path = open < 0 ? undefined : readQuoted(source, open + 1);
      if (path === undefined) dynamicCount += 1;
      else keys.push(`${match[1]!.toUpperCase()}|${path.value}`);
    }
    const routeAnchors = [...source.matchAll(/\bapp\.route\b/g)];
    const loopRoutes = [...source.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s*\[\s*(["']\w+["']\s*,\s*["']\w+["'])\s*\]\s+as\s+const\s*\)\s*app\.route[\s\S]*?\(\s*\{\s*method\s*,\s*url\s*:\s*(["'`])([^"'`]+)\3/g)];
    for (const match of loopRoutes) {
      const methods = [...match[2]!.matchAll(/["'](\w+)["']/g)].map((entry) => entry[1]!.toUpperCase());
      if (methods.length !== 2 || methods.some((method) => !METHODS.has(method as HttpRouteMethod))) dynamicCount += 1;
      else for (const method of methods) keys.push(`${method}|${match[4]!}`);
    }
    dynamicCount += routeAnchors.length - loopRoutes.length;
  }
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return { keys: [...new Set(keys)].sort(), duplicateKeys: [...counts].filter(([, count]) => count > 1).map(([key]) => key).sort(), dynamicCount };
}

describe("HTTP route surface structural audit", () => {
  it("extracts the exact independently scanned 81-endpoint set with stable evidence", () => {
    const result = extractHttpRouteSurface({ runtimeRoot });
    const oracle = rawOracle();
    const extractedKeys = result.endpoints.map((endpoint) => endpoint.key);
    const extractedSet = new Set(extractedKeys);
    const oracleSet = new Set(oracle.keys);
    const orphanKeys = oracle.keys.filter((key) => !extractedSet.has(key));
    const extraKeys = extractedKeys.filter((key) => !oracleSet.has(key));

    assert.deepEqual({ orphanCount: orphanKeys.length, extraCount: extraKeys.length, duplicateCount: result.duplicateKeys.length, dynamicCount: result.dynamicRegistrations.length }, { orphanCount: 0, extraCount: 0, duplicateCount: 0, dynamicCount: 0 });
    assert.deepEqual({ oracleDuplicateCount: oracle.duplicateKeys.length, oracleDynamicCount: oracle.dynamicCount }, { oracleDuplicateCount: 0, oracleDynamicCount: 0 });
    assert.equal(result.logicalEndpointCount, 81);
    assert.deepEqual(result.counts, { GET: 33, POST: 28, PATCH: 5, PUT: 5, DELETE: 10 });
    assert.deepEqual(extractedKeys, oracle.keys);
    assert.equal(result.endpointSetSha256, createHash("sha256").update(oracle.keys.join("\n"), "utf8").digest("hex"));
    for (const endpoint of result.endpoints) {
      assert.equal(endpoint.key, `${endpoint.method}|${endpoint.path}`);
      assert.ok(endpoint.registrar.startsWith("register"));
      assert.ok(endpoint.module.startsWith("src/"));
      assert.match(endpoint.sourceSpan.sha256, /^[a-f0-9]{64}$/);
      assert.ok(endpoint.sourceSpan.end > endpoint.sourceSpan.start);
      assert.ok(endpoint.sourceSpan.startLine > 0 && endpoint.sourceSpan.startColumn > 0);
    }
  });

  it("wires all eight DB-backed registrars in app.ts exactly once", () => {
    const appSource = maskComments(readFileSync(resolve(runtimeRoot, "src/app.ts"), "utf8"));
    assert.equal(HTTP_ROUTE_MODULE_SPECS.length, 8);
    for (const { registrar } of HTTP_ROUTE_MODULE_SPECS) {
      const calls = [...appSource.matchAll(new RegExp(`\\b${registrar}\\s*\\(`, "g"))];
      assert.equal(calls.length, 1, `${registrar} must be called exactly once in app.ts`);
    }
  });
});
