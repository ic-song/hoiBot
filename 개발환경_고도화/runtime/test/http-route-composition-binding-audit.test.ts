import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { auditHttpRouteCompositionBindings } from "../src/data-migration/http-route-composition-binding-audit.js";
import {
  applyObjectDbConsumerClassificationDelta, sealObjectDbConsumerClassificationDelta, sha256ConsumerSet,
  type ObjectDbConsumerClassificationDelta,
} from "../src/data-migration/object-db-consumer-classification-delta.js";
import type { ConsumerManifest } from "../src/data-migration/object-db-consumer-transition-audit.js";
import { extractHttpRouteSurface, type HttpRouteSurfaceEntry } from "../src/data-migration/http-route-surface-audit.js";

const runtimeRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(runtimeRoot, "../..");

function knownSqlTables(): Set<string> {
  const migrationRoot = resolve(runtimeRoot, "migrations");
  const tables = readdirSync(migrationRoot).filter((name) => name.endsWith(".sql")).flatMap((name) =>
    [...readFileSync(resolve(migrationRoot, name), "utf8").matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([a-z][a-z0-9_]*)`?/gi)]
      .map((match) => match[1]!));
  return new Set(tables);
}

test("admin balance pilot resolves four routes through concrete composition and SQL closure", () => {
  const endpoints = extractHttpRouteSurface({ runtimeRoot }).endpoints
    .filter(({ registrar }) => registrar === "registerAdminBalanceWebRoutes");
  const evidence = auditHttpRouteCompositionBindings({ repoRoot, runtimeRoot, endpoints, knownSqlTables: knownSqlTables() });
  assert.equal(evidence.length, 4);
  assert.deepEqual(evidence.map(({ endpointKey }) => endpointKey), [
    "GET|/api/v1/admin/balance",
    "POST|/api/v1/admin/balance/:domain/apply",
    "POST|/api/v1/admin/balance/:domain/preview",
    "POST|/api/v1/admin/balance/:domain/rollback",
  ]);
  for (const entry of evidence) {
    assert.equal(entry.resolved, true, `${entry.endpointKey}: ${entry.unresolvedReasons.join(",")}`);
    assert.equal(entry.unresolvedReasons.length, 0);
    assert.ok(entry.dependencyCalls.includes("auth.authenticate"));
    assert.ok(entry.methodClosure.some(({ symbol }) => symbol === "AdminAuthService.authenticate"));
    assert.ok(entry.observedSqlReadTables.length > 0);
    assert.match(entry.evidenceSha256, /^[a-f0-9]{64}$/);
  }
});

function tamperEvidence(binding: string): ReturnType<typeof auditHttpRouteCompositionBindings>[number] {
  const root = mkdtempSync(resolve(tmpdir(), "hoibot-http-binding-"));
  const sourceRoot = resolve(root, "src");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(resolve(sourceRoot, "provider.ts"), [
    "export class Reader {",
    "  constructor(private readonly database: unknown) {}",
    "  async read(): Promise<void> { await (this.database as any).query('SELECT value FROM canonical_probe'); }",
    "}",
  ].join("\n"));
  writeFileSync(resolve(sourceRoot, "routes.ts"), [
    "export function registerProbeRoutes(app: any, dependencies: { reader: { read(): Promise<void> } }): void {",
    "  app.get('/probe', async () => { await dependencies.reader.read(); });",
    "}",
  ].join("\n"));
  writeFileSync(resolve(sourceRoot, "app.ts"), [
    "import { Reader } from './provider.js';",
    "import { registerProbeRoutes } from './routes.js';",
    "declare const app: any; declare const database: unknown; declare const injected: Reader | undefined; declare const flag: boolean;",
    `registerProbeRoutes(app, { reader: ${binding} });`,
  ].join("\n"));
  const endpoint: HttpRouteSurfaceEntry = {
    key: "GET /probe", method: "GET", path: "/probe", module: "src/routes.ts", registrar: "registerProbeRoutes",
    sourceSpan: { start: 0, end: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, sha256: "0".repeat(64) },
  };
  try {
    return auditHttpRouteCompositionBindings({ repoRoot: root, runtimeRoot: root, endpoints: [endpoint], knownSqlTables: new Set(["canonical_probe"]) })[0]!;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("nullish composition alternatives remain unresolved", () => {
  const evidence = tamperEvidence("injected ?? new Reader(database)");
  assert.equal(evidence.resolved, false);
  assert.deepEqual(evidence.dependencyCalls, ["reader.read"]);
  assert.deepEqual(evidence.unresolvedReasons, ["NULLISH_BINDING_NOT_UNIQUE", "SQL_TARGET_CLOSURE_EMPTY"]);
});

test("conditional composition alternatives remain unresolved even for the same class", () => {
  const evidence = tamperEvidence("flag ? new Reader(database) : new Reader({})");
  assert.equal(evidence.resolved, false);
  assert.deepEqual(evidence.dependencyCalls, ["reader.read"]);
  assert.deepEqual(evidence.unresolvedReasons, ["CONDITIONAL_BINDING_NOT_UNIQUE", "SQL_TARGET_CLOSURE_EMPTY"]);
});

test("SCD applies only 78 resolved routes and fails closed on base or operation tampering", () => {
  const base = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"), "utf8")) as ConsumerManifest;
  const delta = JSON.parse(readFileSync(resolve(repoRoot, "개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-20260909-1.v1.json"), "utf8")) as ObjectDbConsumerClassificationDelta;
  const applied = applyObjectDbConsumerClassificationDelta(base, delta);
  assert.equal(delta.operations.length, 78);
  assert.equal(delta.audit.entries.length, 81);
  assert.equal(delta.audit.entries.filter(({ resolved }) => !resolved).length, 3);
  assert.equal(applied.consumerSetSha256, sha256ConsumerSet(applied.consumers));
  assert.notEqual(applied.consumerSetSha256, base.consumerSetSha256);
  const tamperedBase = structuredClone(base);
  tamperedBase.consumers.find(({ kind }) => kind !== "HTTP_WEB_ROUTE")!.symbol += "-tampered";
  assert.throws(() => applyObjectDbConsumerClassificationDelta(tamperedBase, delta), /BASE_DRIFT/);
  const tamperedDelta = structuredClone(delta);
  tamperedDelta.operations[0]!.after.unresolvedDynamicCallCount = 1;
  const { deltaSha256: _ignored, ...tamperedPayload } = tamperedDelta;
  const resealed = sealObjectDbConsumerClassificationDelta(tamperedPayload);
  assert.throws(() => applyObjectDbConsumerClassificationDelta(base, resealed), /REPLACEMENT_DRIFT|RESOLUTION_INCOMPLETE/);
});
