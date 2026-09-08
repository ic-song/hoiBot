import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { DatabaseTransaction, DatabaseWriteResult, RootTransactionDatabaseClient } from "../src/database.js";
import { executeItemBagReadOnlyRecovery } from "../src/inventory/item-bag-read-only-recovery-ingress.js";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../src/runtime/environment-context.js";

const token = "item-bag-shadow-token";

describe("WBS776 actual /가방 SHADOW ingress", () => {
  it("submits only a typed SHADOW evaluation and suppresses legacy delivery on evaluation error", async () => {
    const database = {
      query: async <T>(sql: string): Promise<T> => sql === "SELECT DATABASE() AS database_identity" ? [{ database_identity: "item_bag_shadow" }] as T : [] as T,
      execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n }),
      withTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => work(database as DatabaseTransaction),
      withRootTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => work(database as DatabaseTransaction),
      ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
    } as RootTransactionDatabaseClient;
    const environmentContext = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "item_bag_shadow" }));
    let submittedRoute: string | undefined;
    let submittedChannelName: unknown;
    let evaluation: Record<string, unknown> | undefined;
    const event = { eventId: "iris:shadow-only", channelId: "room-1", userId: "user-1", message: "/가방", senderName: "회원", raw: {} } as never;
    const result = await executeItemBagReadOnlyRecovery({
      database,
      recovery: { execute: async (input: any) => {
        submittedRoute = input.decision.route;
        submittedChannelName = input.channelName;
        evaluation = await input.evaluateInSnapshot({ query: async <T>() => [] as T });
        input.validateReceiptProjection((evaluation as any).receiptProjection);
        const processing = { duplicate: false, replies: [] };
        await input.afterEvaluateInTransaction(database as DatabaseTransaction, processing, {
          replayed: false, terminalStatus: "SHADOW_EVALUATED", receiptProjection: (evaluation as any).receiptProjection,
        });
        return { processing, receiptProjection: (evaluation as any).receiptProjection };
      } },
      canonical: { execute: async () => { throw new Error("CANONICAL_SNAPSHOT_UNAVAILABLE"); } },
      environmentContext, event, replyIdentity: event, channelType: "open_group", reasonCode: "ROLLOUT_SHADOW",
      channelName: { displayName: "가방방", sourceCode: "kakao_open_link" },
    } as never);
    assert.equal(submittedRoute, "SHADOW");
    assert.deepEqual(submittedChannelName, { displayName: "가방방", sourceCode: "kakao_open_link" });
    assert.equal((evaluation as any).terminalStatus, undefined);
    assert.equal((evaluation as any).reply, undefined);
    assert.deepEqual((evaluation as any).value, { status: "evaluation_error", delivery: "silent", reason: "CANONICAL_EVALUATION_ERROR" });
    assert.equal(result.queuedReply, undefined);
  });

  it("rolls back an atomic transient crash and commits one legacy outbox with one SHADOW receipt", async () => {
    let nextId = 1n, immediateReplies = 0, evaluations = 0, replays = 0;
    let crashBeforeFirstReceipt = true;
    const writes: string[] = [], outboxPayloads: string[] = [], receipts = new Map<string, unknown>();
    const inbox = new Map<string, { error_code: string | null; processing_status: string }>();
    const transaction: DatabaseTransaction = {
      query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
        if (sql.includes("FROM event_inbox WHERE event_id=? FOR UPDATE")) {
          const row = inbox.get(String(values[0]));
          return (row === undefined ? [] : [row]) as T;
        }
        if (sql.includes("SELECT id FROM channels")) return [{ id: 11n }] as T;
        if (sql.includes("SELECT id FROM external_identities")) return [{ id: 12n }] as T;
        if (sql.includes("FROM external_identity_names")) return [] as T;
        if (sql.includes("FROM command_executions execution")) return outboxPayloads.map((payload) => ({
          command_code: "bag_read", execution_status: "completed", result_code: "reply_queued", operation_status: "completed",
          provider_code: "iris", destination_id: "room-1", message_type: "text", payload_json: payload,
        })) as T;
        if (sql.includes("SELECT player_id, display_name")) return [{ player_id: 42n, display_name: "기존회원" }] as T;
        if (sql.includes("FROM inventory_stacks stack")) return [{ display_name: "기존상자🎁", quantity: 3n, legacy_bag_order: null }] as T;
        if (sql.includes("legacy.bag.advertisement")) return [{ string_value: "기존광고" }] as T;
        return [] as T;
      },
      execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
        writes.push(sql);
        if (sql.includes("INSERT INTO event_inbox")) {
          const eventId = String(values[0]);
          if (!inbox.has(eventId)) inbox.set(eventId, { error_code: String(values.at(-1)), processing_status: "processing" });
        }
        if (sql.includes("UPDATE event_inbox SET processing_status='processed'")) {
          const eventId = String(values[0]);
          inbox.set(eventId, { error_code: null, processing_status: "processed" });
        }
        if (sql.includes("INSERT INTO outbox_messages")) outboxPayloads.push(String(values[2]));
        return { affectedRows: 1n, insertId: nextId++ };
      },
    };
    const database: RootTransactionDatabaseClient = {
      ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
      execute: transaction.execute,
      withTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction),
      withRootTransaction: async <T>(work: (tx: DatabaseTransaction) => Promise<T>) => work(transaction),
      query: async <T>(sql: string): Promise<T> => {
        if (sql === "SELECT DATABASE() AS database_identity") return [{ database_identity: "item_bag_shadow" }] as T;
        if (sql.includes("FROM command_aliases a")) return [{ command_code: "ITEM_BAG_READ", handler_key: "item_bag_canonical_read", auth_scope: "VERIFIED_USER", rollout_state: "SHADOW" }] as T;
        if (sql.includes("SELECT player_id, display_name")) return [{ player_id: 42n, display_name: "기존회원" }] as T;
        if (sql.includes("FROM inventory_stacks stack")) return [{ display_name: "기존상자🎁", quantity: 3n, legacy_bag_order: null }] as T;
        if (sql.includes("legacy.bag.advertisement")) return [{ string_value: "기존광고" }] as T;
        return [] as T;
      },
    };
    const context = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "item_bag_shadow" }));
    const recovery = { execute: async (input: any) => {
      const prior = receipts.get(input.event.eventId);
      if (prior !== undefined) {
        input.validateReceiptProjection(prior);
        const processing = { duplicate: true, replies: [] };
        await input.afterEvaluateInTransaction(transaction, processing, { replayed: true, terminalStatus: "SHADOW_EVALUATED", receiptProjection: prior });
        replays += 1;
        return { status: "completed", replayed: true, terminalStatus: "SHADOW_EVALUATED", resultFingerprint: "f".repeat(64), receiptProjection: prior, processing };
      }
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const writeMark = writes.length, outboxMark = outboxPayloads.length;
        try {
          const processing = { duplicate: false, replies: [] };
          evaluations += 1;
          const evaluated = await input.evaluateInSnapshot(transaction);
          input.validateReceiptProjection(evaluated.receiptProjection);
          receipts.set(input.event.eventId, evaluated.receiptProjection);
          await input.afterEvaluateInTransaction(transaction, processing, { replayed: false, terminalStatus: "SHADOW_EVALUATED", receiptProjection: evaluated.receiptProjection });
          if (crashBeforeFirstReceipt) {
            crashBeforeFirstReceipt = false;
            throw Object.assign(new Error("SIMULATED_ATOMIC_TRANSIENT_CRASH"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
          }
          return { status: "completed", replayed: false, terminalStatus: "SHADOW_EVALUATED", resultFingerprint: "f".repeat(64), receiptProjection: evaluated.receiptProjection, value: evaluated.value, processing };
        } catch (error) {
          receipts.delete(input.event.eventId);
          writes.length = writeMark; outboxPayloads.length = outboxMark;
          if (!(error instanceof Error && "errno" in error && error.errno === 1213) || attempt === 2) throw error;
        }
      }
      throw new Error("unreachable");
    } };
    const canonical = { execute: async () => ({ status: "legacy_reply" as const, consumerId: "legacy-94904fa11988ff04" as const, reason: "CANONICAL_IMPORT_INCOMPLETE" as const, playerId: "42", parityFingerprint: "a".repeat(64), data: "shadow-only" }) };
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "item-bag-shadow-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3332", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "item_bag_shadow" });
    const app = buildApp(config, { database, environmentContext: context, itemBagReadOnlyRecoveryProvider: recovery as never, canonicalItemBagService: canonical,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async () => { immediateReplies += 1; } });
    const send = (id: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/가방", room: "가방방", sender: "기존회원", json: { _id: id, chat_id: "room-1", user_id: "user-1" } } });
    try {
      const first = await send("bag-shadow-1");
      assert.equal(first.statusCode, 202, first.body);
      const replayed = await send("bag-shadow-1");
      assert.equal(replayed.statusCode, 202, replayed.body);
      assert.equal(evaluations, 2); assert.equal(replays, 1); assert.equal(immediateReplies, 0);
      assert.equal(writes.filter((sql) => sql.includes("outbox_messages")).length, 1);
      assert.deepEqual(outboxPayloads, [JSON.stringify({ data: "[기존회원]의 가방🧳\n(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n   1. 기존상자🎁 x 3" })]);
      assert.ok(!outboxPayloads[0]!.includes("shadow-only"), "canonical evaluator output is evidence-only in SHADOW");
      assert.ok(writes.every((sql) => !/canonical_(?:owned_item|item_definitions)/.test(sql)), "SHADOW ingress must not mutate canonical item domain");
      const receipt = receipts.get("iris:bag-shadow-1") as any;
      assert.equal(receipt.version, "ITEM_BAG_CANONICAL_DIRECT_READ_V1");
      assert.equal(receipt.value.status, "legacy_reply");
      assert.equal(receipt.value.canonicalDecision.status, "legacy_reply");
      assert.equal(receipt.value.legacyReply.destinationId, "room-1");
      outboxPayloads[0] = JSON.stringify({ data: "tampered" });
      const tampered = await send("bag-shadow-1");
      assert.equal(tampered.statusCode, 500);
      outboxPayloads[0] = JSON.stringify({ data: "[기존회원]의 가방🧳\n(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n   1. 기존상자🎁 x 3" });
      outboxPayloads.length = 0;
      const missing = await send("bag-shadow-1");
      assert.equal(missing.statusCode, 500);
    } finally { await app.close(); }
  });

  it("rejects a historical processed event without a receipt before queuing a legacy outbox", async () => {
    let immediateReplies = 0, hookCalls = 0;
    const database = {
      query: async <T>(sql: string): Promise<T> => sql === "SELECT DATABASE() AS database_identity"
        ? [{ database_identity: "item_bag_shadow" }] as T
        : sql.includes("FROM command_aliases a")
          ? [{ command_code: "ITEM_BAG_READ", handler_key: "item_bag_canonical_read", auth_scope: "VERIFIED_USER", rollout_state: "SHADOW" }] as T
          : [] as T,
      execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 0n, insertId: 0n }),
      withTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => work(database as DatabaseTransaction),
      withRootTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => work(database as DatabaseTransaction),
      ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
    } as RootTransactionDatabaseClient;
    const context = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "item_bag_shadow" }));
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "item-bag-shadow-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3332", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "item_bag_shadow" });
    const app = buildApp(config, { database, environmentContext: context,
      itemBagReadOnlyRecoveryProvider: { execute: async (input: any) => { hookCalls += input.afterEvaluateInTransaction === undefined ? 0 : 1; throw new Error("ATOMIC_EVENT_WITHOUT_RECEIPT_RECOVERY_REQUIRED"); } } as never,
      canonicalItemBagService: { execute: async () => { throw new Error("must-not-evaluate"); } },
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async () => { immediateReplies += 1; } });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/가방", room: "가방방", sender: "기존회원", json: { _id: "historical-preclaim", chat_id: "room-1", user_id: "user-1" } } });
      assert.equal(response.statusCode, 500);
      assert.equal(hookCalls, 1);
      assert.equal(immediateReplies, 0);
    } finally { await app.close(); }
  });

  it("keeps /가방 on the legacy path when the registry is not in SHADOW rollout", async () => {
    let recoveryCalls = 0;
    const database = {
      query: async <T>(sql: string): Promise<T> => sql === "SELECT DATABASE() AS database_identity"
        ? [{ database_identity: "item_bag_shadow" }] as T
        : sql.includes("FROM command_aliases a")
          ? [{ command_code: "ITEM_BAG_READ", handler_key: "item_bag_canonical_read", auth_scope: "VERIFIED_USER", rollout_state: "LEGACY_ONLY" }] as T
          : [] as T,
      execute: async (): Promise<DatabaseWriteResult> => ({ affectedRows: 1n, insertId: 1n }),
      withTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => work(database as DatabaseTransaction),
      withRootTransaction: async <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => work(database as DatabaseTransaction),
      ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined,
    } as RootTransactionDatabaseClient;
    const context = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "item_bag_shadow" }));
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "item-bag-shadow-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3332", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "item_bag_shadow" });
    const app = buildApp(config, { database, environmentContext: context,
      itemBagReadOnlyRecoveryProvider: { execute: async () => { recoveryCalls += 1; throw new Error("must-not-run"); } } as never,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async () => undefined });
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/가방", room: "가방방", sender: "기존회원", json: { _id: "legacy-only", chat_id: "room-1", user_id: "user-1" } } });
      assert.equal(response.statusCode, 202, response.body);
      assert.equal(recoveryCalls, 0);
    } finally { await app.close(); }
  });
});
