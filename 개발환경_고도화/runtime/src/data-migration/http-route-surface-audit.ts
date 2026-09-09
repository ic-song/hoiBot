import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readCanonicalObjectDbConsumerSource } from "./object-db-consumer-baseline.js";

export type HttpRouteMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface HttpRouteModuleSpec { module: string; registrar: string; }
export interface HttpRouteSourceSpan { start: number; end: number; startLine: number; startColumn: number; endLine: number; endColumn: number; sha256: string; }
export interface HttpRouteSurfaceEntry { key: string; method: HttpRouteMethod; path: string; module: string; registrar: string; sourceSpan: HttpRouteSourceSpan; }
export interface DynamicHttpRouteRegistration { module: string; registrar: string; sourceSpan: HttpRouteSourceSpan; reason: string; }
export interface HttpRouteSurfaceAudit {
  format: "hoibot-http-route-surface-v1";
  runtimeRoot: string;
  modules: HttpRouteModuleSpec[];
  endpoints: HttpRouteSurfaceEntry[];
  counts: Record<HttpRouteMethod, number>;
  logicalEndpointCount: number;
  duplicateKeys: string[];
  dynamicRegistrations: DynamicHttpRouteRegistration[];
  endpointSetSha256: string;
}

export const HTTP_ROUTE_MODULE_SPECS: readonly HttpRouteModuleSpec[] = [
  { module: "src/admin/routes.ts", registrar: "registerAdminRoutes" },
  { module: "src/admin/diamond-shop-catalog-web-routes.ts", registrar: "registerAdminDiamondShopCatalogWebRoutes" },
  { module: "src/admin/package-catalog-web-routes.ts", registrar: "registerAdminPackageCatalogWebRoutes" },
  { module: "src/admin/object-catalog-web-routes.ts", registrar: "registerAdminObjectCatalogWebRoutes" },
  { module: "src/admin/configuration-catalog-web-routes.ts", registrar: "registerAdminConfigurationCatalogWebRoutes" },
  { module: "src/admin/pet-skill-catalog-web-routes.ts", registrar: "registerAdminPetSkillCatalogWebRoutes" },
  { module: "src/admin/admin-balance-web-routes.ts", registrar: "registerAdminBalanceWebRoutes" },
  { module: "src/user-auth/routes.ts", registrar: "registerUserAuthRoutes" }
];

interface Token { kind: "identifier" | "string" | "dynamic-template" | "punctuation"; value: string; start: number; end: number; }
const DIRECT_METHODS = new Map<string, HttpRouteMethod>([["get", "GET"], ["post", "POST"], ["patch", "PATCH"], ["put", "PUT"], ["delete", "DELETE"]]);

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function normalPath(value: string): string { return value.split(sep).join("/"); }
function isHttpMethod(value: string): value is HttpRouteMethod { return value === "GET" || value === "POST" || value === "PATCH" || value === "PUT" || value === "DELETE"; }

function discoverRuntimeRoot(): string {
  for (const start of [process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
    let cursor = resolve(start);
    for (;;) {
      if (existsSync(resolve(cursor, "package.json")) && existsSync(resolve(cursor, "src/app.ts"))) return cursor;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  throw new Error("HTTP_ROUTE_RUNTIME_ROOT_NOT_FOUND");
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < source.length;) {
    const start = index;
    const char = source[index]!;
    const next = source[index + 1];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "/" && next === "/") { index += 2; while (index < source.length && source[index] !== "\n") index += 1; continue; }
    if (char === "/" && next === "*") { index += 2; while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1; index = Math.min(source.length, index + 2); continue; }
    if (/[A-Za-z_$]/.test(char)) {
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index]!)) index += 1;
      tokens.push({ kind: "identifier", value: source.slice(start, index), start, end: index });
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      const quote = char;
      let value = "";
      let dynamic = false;
      index += 1;
      while (index < source.length) {
        const current = source[index]!;
        if (current === "\\") { value += current + (source[index + 1] ?? ""); index += 2; continue; }
        if (quote === "`" && current === "$" && source[index + 1] === "{") dynamic = true;
        if (current === quote) { index += 1; break; }
        value += current;
        index += 1;
      }
      tokens.push({ kind: dynamic ? "dynamic-template" : "string", value, start, end: index });
      continue;
    }
    tokens.push({ kind: "punctuation", value: char, start, end: start + 1 });
    index += 1;
  }
  return tokens;
}

function matchingToken(tokens: Token[], openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index]!.value === open) depth += 1;
    else if (tokens[index]!.value === close && --depth === 0) return index;
  }
  return -1;
}

function registrarBounds(tokens: Token[], registrar: string): { start: number; end: number } {
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]!.value !== "function" || tokens[index + 1]!.value !== registrar) continue;
    let body = index + 2;
    while (body < tokens.length && tokens[body]!.value !== "{") body += 1;
    const end = body < tokens.length ? matchingToken(tokens, body, "{", "}") : -1;
    if (end >= 0) return { start: body + 1, end };
  }
  throw new Error(`HTTP_ROUTE_REGISTRAR_NOT_FOUND:${registrar}`);
}

function callOpen(tokens: Token[], memberIndex: number): number {
  let cursor = memberIndex + 1;
  if (tokens[cursor]?.value === "<") {
    cursor = matchingToken(tokens, cursor, "<", ">");
    if (cursor < 0) return -1;
    cursor += 1;
  }
  return tokens[cursor]?.value === "(" ? cursor : -1;
}

function objectProperty(tokens: Token[], start: number, end: number, name: string): number | undefined {
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const value = tokens[index]!.value;
    if (value === "{" || value === "[" || value === "(") depth += 1;
    else if (value === "}" || value === "]" || value === ")") depth -= 1;
    else if (depth === 0 && value === name && tokens[index + 1]?.value === ":") return index + 2;
    else if (depth === 0 && value === name && (tokens[index + 1]?.value === "," || index + 1 === end)) return index;
  }
  return undefined;
}

function enclosingLoopMethods(tokens: Token[], callIndex: number, identifier: string): { methods: HttpRouteMethod[]; start: number } | undefined {
  for (let start = callIndex - 1; start >= Math.max(0, callIndex - 40); start -= 1) {
    if (tokens[start]!.value !== "for") continue;
    const open = start + 1;
    if (tokens[open]?.value !== "(") continue;
    const close = matchingToken(tokens, open, "(", ")");
    if (close < 0 || close >= callIndex) continue;
    const loopTokens = tokens.slice(open + 1, close);
    const variableIndex = loopTokens.findIndex((token) => token.value === identifier);
    const ofIndex = loopTokens.findIndex((token) => token.value === "of");
    if (variableIndex < 0 || ofIndex < 0) continue;
    const arrayOpen = open + 1 + ofIndex + 1;
    if (tokens[arrayOpen]?.value !== "[") continue;
    const arrayClose = matchingToken(tokens, arrayOpen, "[", "]");
    if (arrayClose < 0 || arrayClose > close) continue;
    const values = tokens.slice(arrayOpen + 1, arrayClose).filter((token) => token.kind === "string").map((token) => token.value.toUpperCase());
    return values.length > 0 && values.every(isHttpMethod) ? { methods: values, start: tokens[start]!.start } : undefined;
  }
  return undefined;
}

function spanFor(source: string, start: number, end: number): HttpRouteSourceSpan {
  const position = (offset: number): { line: number; column: number } => {
    const lines = source.slice(0, offset).split("\n");
    return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
  };
  const first = position(start);
  const last = position(end);
  return { start, end, startLine: first.line, startColumn: first.column, endLine: last.line, endColumn: last.column, sha256: sha256(source.slice(start, end)) };
}

export function extractHttpRouteSurface(options: { runtimeRoot?: string } = {}): HttpRouteSurfaceAudit {
  const runtimeRoot = resolve(options.runtimeRoot ?? discoverRuntimeRoot());
  const endpoints: HttpRouteSurfaceEntry[] = [];
  const dynamicRegistrations: DynamicHttpRouteRegistration[] = [];
  for (const spec of HTTP_ROUTE_MODULE_SPECS) {
    const absoluteModule = resolve(runtimeRoot, spec.module);
    const source = readCanonicalObjectDbConsumerSource(absoluteModule);
    const tokens = tokenize(source);
    const bounds = registrarBounds(tokens, spec.registrar);
    for (let index = bounds.start; index < bounds.end - 2; index += 1) {
      if (tokens[index]!.value !== "app" || tokens[index + 1]!.value !== ".") continue;
      const member = tokens[index + 2]!.value;
      const directMethod = DIRECT_METHODS.get(member);
      if (directMethod === undefined && member !== "route") continue;
      const open = callOpen(tokens, index + 2);
      const close = open < 0 ? -1 : matchingToken(tokens, open, "(", ")");
      const startOffset = tokens[index]!.start;
      const endOffset = close < 0 ? tokens[index + 2]!.end : tokens[close]!.end;
      const sourceSpan = spanFor(source, startOffset, endOffset);
      const addDynamic = (reason: string): void => { dynamicRegistrations.push({ module: spec.module, registrar: spec.registrar, sourceSpan, reason }); };
      if (open < 0 || close < 0) { addDynamic(`app.${member} call is not structurally balanced`); continue; }
      if (directMethod !== undefined) {
        const path = tokens[open + 1];
        if (path?.kind !== "string") addDynamic(`app.${member} path is not a static string literal`);
        else endpoints.push({ key: `${directMethod}|${path.value}`, method: directMethod, path: path.value, module: normalPath(relative(runtimeRoot, absoluteModule)), registrar: spec.registrar, sourceSpan });
        index = close;
        continue;
      }
      if (tokens[open + 1]?.value !== "{" || tokens[close - 1]?.value !== "}") { addDynamic("app.route options are not an object literal"); index = close; continue; }
      const pathIndex = objectProperty(tokens, open + 2, close - 1, "url");
      const methodIndex = objectProperty(tokens, open + 2, close - 1, "method");
      const path = pathIndex === undefined ? undefined : tokens[pathIndex];
      const methodToken = methodIndex === undefined ? undefined : tokens[methodIndex];
      const upperMethod = methodToken?.kind === "string" ? methodToken.value.toUpperCase() : undefined;
      const loop = methodToken?.kind === "identifier" ? enclosingLoopMethods(tokens, index, methodToken.value) : undefined;
      const methods = upperMethod !== undefined && isHttpMethod(upperMethod)
        ? [upperMethod]
        : loop?.methods;
      if (path?.kind !== "string" || methods === undefined) addDynamic("app.route method or url is not statically enumerable");
      else {
        const routeSpan = loop === undefined ? sourceSpan : spanFor(source, loop.start, endOffset);
        for (const method of methods) endpoints.push({ key: `${method}|${path.value}`, method, path: path.value, module: normalPath(relative(runtimeRoot, absoluteModule)), registrar: spec.registrar, sourceSpan: routeSpan });
      }
      index = close;
    }
  }
  endpoints.sort((left, right) => left.key.localeCompare(right.key) || left.module.localeCompare(right.module) || left.sourceSpan.start - right.sourceSpan.start);
  const seen = new Set<string>();
  const duplicateKeys = [...new Set(endpoints.flatMap((endpoint) => seen.has(endpoint.key) ? [endpoint.key] : (seen.add(endpoint.key), [])))].sort();
  const counts: Record<HttpRouteMethod, number> = { GET: 0, POST: 0, PATCH: 0, PUT: 0, DELETE: 0 };
  for (const endpoint of endpoints) counts[endpoint.method] += 1;
  return { format: "hoibot-http-route-surface-v1", runtimeRoot, modules: HTTP_ROUTE_MODULE_SPECS.map((spec) => ({ ...spec })), endpoints, counts, logicalEndpointCount: endpoints.length, duplicateKeys, dynamicRegistrations, endpointSetSha256: sha256(endpoints.map((endpoint) => endpoint.key).join("\n")) };
}

export const auditHttpRouteSurface = extractHttpRouteSurface;
