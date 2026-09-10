import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { TitleGiftTicketGrantService } from "../src/admin/title-gift-ticket-grant-service.js";
import { loadConfig } from "../src/config.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const root = resolve(import.meta.dirname, "../../..");
const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
const normalize = (sql: string): string => sql.replace(/\s+/gu, " ").trim();

function legacyExecute(source: string, message: string): { reply: string; quantity: number } {
  const start = source.indexOf('if (msg.trim().startsWith("/타이틀,")');
  const end = source.indexOf('if (msg.trim().startsWith("/펫미니,")', start);
  assert.ok(start >= 0 && end > start, "committed legacy title-ticket branch missing");
  const data = { member: { "합성 대상": { bag: {} as Record<string, number> } } };
  const replies: string[] = [];
  const run = new Function("msg", "sender", "data", "replier", "isMaster", "GLOBAL_CONFIG", source.slice(start, end));
  run(message, "합성 관리자", data, { reply: (value: unknown) => replies.push(String(value)) }, () => true,
    { titleGift: { itemName: "타이틀선물권💝(/타이틀선물 닉네임 내용)" } });
  return { reply: replies[0] ?? "NO_REPLY", quantity: data.member["합성 대상"].bag["타이틀선물권💝(/타이틀선물 닉네임 내용)"] ?? 0 };
}

function createDatabase(authorized = true): any {
  const operations = new Map<string, { id: bigint; result: string | null }>();
  const outboxes = new Map<string, number>();
  const unexpected: string[] = [];
  const queries: string[] = [];
  let nextId = 100n, quantity = 0n, inventoryDml = 0;
  const database: any = {
    async ping() {}, async verifyRollback() { return true; }, async close() {},
    async query(sql: string, values: unknown[] = []) {
      const n = normalize(sql);
      queries.push(n);
      if (n === "SELECT DATABASE() AS database_identity") return [{ database_identity: "wave33_synthetic" }];
      if (n.includes("FROM command_aliases a")) return values[0] === "/타이틀," ? [{ command_code: "ADMIN_TITLE_GIFT_TICKET_GRANT", handler_key: "admin_title_gift_ticket_grant", auth_scope: "VERIFIED_USER", rollout_state: "ACTIVE" }] : [];
      if (n.startsWith("SELECT id FROM channels")) return [{ id: 1n }];
      if (n.startsWith("SELECT id FROM external_identities")) return [{ id: 2n }];
      if (n.includes("FROM external_identities identity") && n.includes("JOIN admin_operator_external_identities")) return authorized ? [{ operator_id: 9n }] : [];
      if (n.startsWith("SELECT result_json FROM operations")) { const prior = operations.get(`${values[0]}:${values[1]}`); return prior === undefined ? [] : [{ result_json: prior.result }]; }
      if (n.includes("FROM (SELECT map.player_id") && n.includes("legacy_identity_map")) return values[0] === "합성 대상" ? [{ player_id: 20n }] : [];
      if (n.startsWith("SELECT id FROM item_definitions")) return [{ id: 30n }];
      if (n.startsWith("SELECT quantity FROM inventory_stacks")) return [{ quantity }];
      if (n.startsWith("SELECT attempt_count + 1 AS next_attempt FROM outbox_messages")) return [{ next_attempt: BigInt((outboxes.get(String(values[0])) ?? 0) + 1) }];
      unexpected.push(`SELECT ${n}`); return [];
    },
    async execute(sql: string, values: unknown[] = []) {
      const n = normalize(sql); let insertId = 0n;
      if (n.startsWith("INSERT INTO operations")) { insertId = nextId++; operations.set(`${values[1]}:${values[2]}`, { id: insertId, result: null }); }
      else if (n.startsWith("INSERT IGNORE INTO inventory_stacks")) inventoryDml += 1;
      else if (n.startsWith("UPDATE inventory_stacks SET quantity=")) { quantity = BigInt(values[0] as bigint); inventoryDml += 1; }
      else if (n.startsWith("INSERT INTO inventory_ledger")) inventoryDml += 1;
      else if (n.startsWith("INSERT INTO outbox_messages")) { insertId = nextId++; outboxes.set(insertId.toString(), 0); }
      else if (n.startsWith("UPDATE operations SET status='completed'")) { const row = [...operations.values()].find(value => value.id === values[1]); if (row) row.result = String(values[0]); }
      else if (n.startsWith("UPDATE outbox_messages SET status")) outboxes.set(String(values[5]), Number(values[1]));
      else if (n.startsWith("INSERT INTO command_routing_decisions") || n.startsWith("INSERT INTO command_executions") || n.startsWith("INSERT INTO command_audit")
        || n.startsWith("INSERT INTO delivery_attempts") || n.startsWith("INSERT INTO channels") || n.startsWith("INSERT INTO external_identities")
        || n.startsWith("INSERT INTO channel_memberships") || n.startsWith("INSERT INTO event_inbox") || n.startsWith("INSERT INTO normalized_provider_events")
        || n.startsWith("INSERT INTO channel_activity_daily") || n.startsWith("UPDATE event_inbox SET processing_status")) { /* observed infrastructure DML */ }
      else unexpected.push(`DML ${n}`);
      return { affectedRows: 1n, insertId };
    },
    async withTransaction<T>(work: (tx: any) => Promise<T>): Promise<T> { return work(database); },
    get quantity() { return quantity; }, get inventoryDml() { return inventoryDml; }, get unexpected() { return unexpected; }, get queries() { return queries; }
  };
  database.withRootTransaction = database.withTransaction;
  return database;
}

describe("WBS800 Wave33 title gift ticket fail-closed evidence", () => {
  it("validates the compatible classification delta without relabeling the frozen manifest", () => {
    const schema = JSON.parse(readFileSync(resolve(root, "개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-33.v1.schema.json"), "utf8"));
    const delta = JSON.parse(readFileSync(resolve(root, "개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-33.v1.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    assert.equal(validate(delta), true, JSON.stringify(validate.errors));
    const manifest = JSON.parse(readFileSync(resolve(root, "개발환경_고도화/migration-control/contracts/object-db-consumer-manifest.v1.json"), "utf8"));
    const frozen = manifest.consumers.find((consumer: any) => consumer.consumerId === "legacy-bda1428003a5b522");
    assert.equal(frozen.access, "READ");
    assert.equal(delta.operations[0].after.accessClass, "MUTATION");
    assert.equal(delta.operations[0].scenarioRequirements.length, 8);
  });

  it("executes committed legacy and actual buildApp success with the same input", async () => {
    const committedMain = execFileSync("git", ["show", "HEAD:main.js"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const legacy = legacyExecute(committedMain, "/타이틀2, 합성 대상");
    const database = createDatabase();
    const token = "wave33-synthetic-token";
    const previous = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "wave33-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3333", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave33_synthetic" });
    const environmentContext = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "wave33_synthetic" }));
    const replies: Array<{ data: string }> = [];
    const app = buildApp(config, { database, environmentContext, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: {} }), sendIrisTextReply: async reply => { replies.push(reply); } });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/타이틀2, 합성 대상", room: "합성방", sender: "합성 관리자", json: { _id: "wave33-success", chat_id: "wave33-room", user_id: "operator", type: 1, v: { origin: "MSG", isMine: false } } } });
      assert.equal(response.statusCode, 202, response.body);
      assert.equal(replies[0]?.data, legacy.reply, JSON.stringify({ body: response.body, unexpected: database.unexpected, queries: database.queries }));
      assert.equal(database.quantity, BigInt(legacy.quantity));
    } finally { await app.close(); if (previous === undefined) delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; else process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previous; }
  });

  it("proves actual service payload drift replays instead of failing closed", async () => {
    const database = createDatabase();
    const service = new TitleGiftTicketGrantService(database);
    const first = await service.grant({ eventId: "wave33-drift", externalUserId: "operator", destinationId: "room", message: "/타이틀2, 합성 대상" });
    const dmlAfterFirst = database.inventoryDml;
    let drift: Awaited<ReturnType<TitleGiftTicketGrantService["grant"]>> | undefined;
    let driftError: unknown = null;
    try { drift = await service.grant({ eventId: "wave33-drift", externalUserId: "operator", destinationId: "room", message: "/타이틀3, 합성 대상" }); }
    catch (error) { driftError = error; }
    assert.equal(first?.status, "granted");
    assert.equal(driftError, null, "actual path unexpectedly failed closed");
    assert.equal(drift?.data, first?.data);
    assert.equal(database.quantity, 2n);
    assert.equal(database.inventoryDml, dmlAfterFirst);
  });
});
