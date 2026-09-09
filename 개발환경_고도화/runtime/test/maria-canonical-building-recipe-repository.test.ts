import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MariaCanonicalBuildingRecipeRepository } from "../src/crafting/maria-canonical-building-recipe-repository.js";

const ok: DatabaseWriteResult = { affectedRows: 1n, insertId: 0n };
const ids = (): (() => string) => { let n = 0; return () => `c${String(++n).padStart(7, "0")}`; };
const craft = (overrides: Partial<{ actor: string; playerId: string; craftRecipeId: string; requestedCount: bigint; requestKey: string; destinationId: string; replyText: string }> = {}) => ({ actor: "tester", playerId: "player01", craftRecipeId: "recipe01", requestedCount: 1n, requestKey: "request-1", destinationId: "room-1", replyText: "조합 완료", ...overrides });

class CraftDatabase implements DatabaseClient, DatabaseTransaction {
  public recipe = { active_flag: 1, maximum_batch_count: 10n, craft_recipe_kind: "item_exchange" };
  public itemInputs = [{ target_id: "stone001", amount: 1n }];
  public itemOutputs = [{ target_id: "box00001", amount: 1n }];
  public currencyInputs = [{ target_id: "point001", amount: 500_000_000n }];
  public currencyOutputs: Array<{ target_id: string; amount: bigint }> = [];
  public stacks = new Map<string, { id: string; quantity: bigint }>([["stone001", { id: "stack001", quantity: 2n }]]);
  public balances = new Map<string, { id: string; amount: bigint }>([["point001", { id: "bal00001", amount: 1_000_000_000n }]]);
  public operation: { craft_operation_id: string; craft_recipe_id: string; requested_count: bigint; payload_fingerprint: string; operation_status: string } | undefined;
  public concurrentOperation: CraftDatabase["operation"];
  public concurrentCommonOperations: Array<{ operationId: bigint; status: string }> = [];
  public concurrentOutboxMessages: Array<{ operationId: bigint; craftOperationId: string; playerId: string }> = [];
  public injectConcurrentDuplicate = false;
  public importRow: { definition_id: string; payload_fingerprint: string } | undefined;
  public executions: Array<{ sql: string; values: readonly unknown[] }> = [];
  public failTransactions = 0;
  public failOutbox = false;

  async ping(): Promise<void> {} async verifyRollback(): Promise<boolean> { return true; } async close(): Promise<void> {}
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    if (this.failTransactions > 0) { this.failTransactions -= 1; throw { code: "ER_LOCK_DEADLOCK", errno: 1213 }; }
    const stacks = new Map([...this.stacks].map(([key, row]) => [key, { ...row }]));
    const balances = new Map([...this.balances].map(([key, row]) => [key, { ...row }]));
    const operation = this.operation === undefined ? undefined : { ...this.operation };
    const executionCount = this.executions.length;
    try { return await work(this); }
    catch (error) { this.stacks = stacks; this.balances = balances; this.operation = operation; this.executions.length = executionCount; throw error; }
  }
  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    if (sql.includes("FROM canonical_craft_operations")) return ((this.operation ?? this.concurrentOperation) === undefined ? [] : [this.operation ?? this.concurrentOperation]) as T;
    if (sql.includes("FROM canonical_craft_recipe_definitions")) return [this.recipe] as T;
    if (sql.includes("canonical_craft_recipe_item_inputs")) return this.itemInputs as T;
    if (sql.includes("canonical_craft_recipe_item_outputs")) return this.itemOutputs as T;
    if (sql.includes("canonical_craft_recipe_currency_inputs")) return this.currencyInputs as T;
    if (sql.includes("canonical_craft_recipe_currency_outputs")) return this.currencyOutputs as T;
    if (sql.includes("FROM canonical_owned_item_stacks")) { const row = this.stacks.get(String(values[1])); return (row === undefined ? [] : [{ owned_item_stack_id: row.id, quantity: row.quantity }]) as T; }
    if (sql.includes("FROM canonical_player_currency_balances")) { const row = this.balances.get(String(values[1])); return (row === undefined ? [] : [{ player_currency_balance_id: row.id, balance_minor_amount: row.amount }]) as T; }
    if (sql.includes("definition_imports")) return (this.importRow === undefined ? [] : [this.importRow]) as T;
    return [] as T;
  }
  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    this.executions.push({ sql, values });
    if (sql.startsWith("INSERT INTO canonical_craft_operations")) {
      this.operation = { craft_operation_id: String(values[0]), craft_recipe_id: String(values[2]), requested_count: values[4] as bigint, payload_fingerprint: String(values[5]), operation_status: "processing" };
      if (this.injectConcurrentDuplicate) {
        this.injectConcurrentDuplicate = false;
        this.concurrentOperation = { ...this.operation, craft_operation_id: "winner01", operation_status: "completed" };
        this.concurrentCommonOperations.push({ operationId: 901n, status: "completed" });
        this.concurrentOutboxMessages.push({ operationId: 901n, craftOperationId: "winner01", playerId: String(values[1]) });
        throw { code: "ER_DUP_ENTRY", message: "Duplicate entry for key 'uq_canonical_craft_operation_request'" };
      }
    }
    if (sql.startsWith("INSERT INTO outbox_messages") && this.failOutbox) throw new Error("OUTBOX_WRITE_FAILED");
    if (sql.startsWith("UPDATE canonical_craft_operations") && this.operation !== undefined) this.operation.operation_status = "completed";
    if (sql.startsWith("INSERT INTO canonical_owned_item_stacks")) this.stacks.set(String(values[2]), { id: String(values[0]), quantity: 0n });
    if (sql.startsWith("UPDATE canonical_owned_item_stacks")) { const row = [...this.stacks.values()].find((entry) => entry.id === values[3]); if (row !== undefined) row.quantity = values[0] as bigint; }
    if (sql.startsWith("INSERT INTO canonical_player_currency_balances")) this.balances.set(String(values[2]), { id: String(values[0]), amount: 0n });
    if (sql.startsWith("UPDATE canonical_player_currency_balances")) { const row = [...this.balances.values()].find((entry) => entry.id === values[3]); if (row !== undefined) row.amount = values[0] as bigint; }
    if (sql.startsWith("INSERT INTO operations")) return { affectedRows: 1n, insertId: 101n };
    if (sql.startsWith("INSERT INTO outbox_messages")) return { affectedRows: 1n, insertId: 202n };
    return ok;
  }
}

describe("MariaCanonicalBuildingRecipeRepository", () => {
  it("registers building and typed recipe definitions with CUID2/KST audit values", async () => {
    const buildingDb = new CraftDatabase();
    const building = await new MariaCanonicalBuildingRecipeRepository(buildingDb, ids(), 3, () => new Date("2026-09-03T00:00:00Z")).registerBuilding({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "HOME_INFO", sourceIdentifier: "homeInfo[0]", buildingName: "서울역 4번출구🚉", floorValue: 1, experienceRequired: 0n });
    assert.equal(building.buildingId, "c0000001");
    assert.ok(buildingDb.executions.some((entry) => entry.values.includes("2026-09-03 09:00:00")));
    const recipeDb = new CraftDatabase();
    const recipe = await new MariaCanonicalBuildingRecipeRepository(recipeDb, ids()).registerRecipe({ actor: "tester", sourceSystem: "RHINO", sourceNamespace: "COMMAND", sourceIdentifier: "/다이아조합", recipeName: "다이아상자 조합", recipeKind: "item_exchange", maximumBatchCount: 1000n, itemInputs: [{ targetId: "stone001", amount: 1n }], currencyInputs: [{ targetId: "point001", amount: 500_000_000n }], itemOutputs: [{ targetId: "box00001", amount: 1n }], currencyOutputs: [] });
    assert.equal(recipe.craftRecipeId, "c0000001");
    for (const table of ["canonical_craft_recipe_definitions", "canonical_craft_recipe_item_inputs", "canonical_craft_recipe_currency_inputs", "canonical_craft_recipe_item_outputs"]) assert.ok(recipeDb.executions.some((entry) => entry.sql.includes(table)));
    const buildingRecipeDb = new CraftDatabase();
    await new MariaCanonicalBuildingRecipeRepository(buildingRecipeDb, ids()).registerRecipe({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "HOME_INFO", sourceIdentifier: "homeInfo[0].required", recipeName: "서울역 4번출구 승급", recipeKind: "building_upgrade", maximumBatchCount: 1n, buildingId: "build001", itemInputs: [{ targetId: "stone001", amount: 1n }], currencyInputs: [], itemOutputs: [], currencyOutputs: [] });
    assert.ok(buildingRecipeDb.executions.some((entry) => entry.sql.includes("canonical_building_craft_recipes")));
  });

  it("rejects definition replay with a different payload and duplicate typed targets", async () => {
    const conflict = new CraftDatabase(); conflict.importRow = { definition_id: "build001", payload_fingerprint: "different" };
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(conflict, ids()).registerBuilding({ actor: "tester", sourceSystem: "LEGACY_JSON", sourceNamespace: "HOME_INFO", sourceIdentifier: "homeInfo[0]", buildingName: "서울역 4번출구🚉", floorValue: 1, experienceRequired: 0n }), /DEFINITION_PAYLOAD_CONFLICT/);
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(new CraftDatabase(), ids()).registerRecipe({ actor: "tester", sourceSystem: "RHINO", sourceNamespace: "COMMAND", sourceIdentifier: "duplicate", recipeName: "invalid", recipeKind: "item_exchange", maximumBatchCount: 1n, itemInputs: [{ targetId: "stone001", amount: 1n }, { targetId: "stone001", amount: 2n }], currencyInputs: [], itemOutputs: [{ targetId: "box00001", amount: 1n }], currencyOutputs: [] }), /DUPLICATE_TARGET/);
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(new CraftDatabase(), ids()).registerRecipe({ actor: "tester", sourceSystem: "RHINO", sourceNamespace: "COMMAND", sourceIdentifier: "overlap", recipeName: "invalid", recipeKind: "item_exchange", maximumBatchCount: 1n, itemInputs: [{ targetId: "stone001", amount: 1n }], currencyInputs: [], itemOutputs: [{ targetId: "stone001", amount: 1n }], currencyOutputs: [] }), /INPUT_OUTPUT_OVERLAP/);
  });

  it("atomically consumes typed item/currency inputs and grants the exact output", async () => {
    const db = new CraftDatabase();
    const repository = new MariaCanonicalBuildingRecipeRepository(db, ids(), 3, () => new Date("2026-09-03T00:00:00Z"));
    const result = await repository.execute(craft({ requestedCount: 2n, requestKey: "diamond-2" }));
    assert.equal(result.replayed, false);
    assert.equal(db.stacks.get("stone001")?.quantity, 0n);
    assert.equal(db.stacks.get("box00001")?.quantity, 2n);
    assert.equal(db.balances.get("point001")?.amount, 0n);
    assert.equal(db.executions.filter((entry) => entry.sql.includes("ledger_entries")).length, 3);
    assert.equal(db.executions.filter((entry) => entry.sql.startsWith("INSERT INTO outbox_messages")).length, 1);
    assert.ok(db.executions.findIndex((entry) => entry.sql.includes("ledger_entries")) < db.executions.findIndex((entry) => entry.sql.startsWith("INSERT INTO outbox_messages")));
  });

  it("replays the committed result and rejects a changed payload", async () => {
    const db = new CraftDatabase(); const repository = new MariaCanonicalBuildingRecipeRepository(db, ids());
    const input = craft({ requestKey: "same-request" });
    await repository.execute(input);
    const before = db.executions.length;
    assert.equal((await repository.execute(input)).replayed, true);
    assert.equal(db.executions.length, before);
    await assert.rejects(() => repository.execute({ ...input, requestedCount: 2n }), /REQUEST_PAYLOAD_CONFLICT/);
  });

  it("retries a deadlock but bounds exhaustion", async () => {
    const db = new CraftDatabase(); db.failTransactions = 1;
    assert.equal((await new MariaCanonicalBuildingRecipeRepository(db, ids(), 2).execute(craft({ requestKey: "retry-ok" }))).replayed, false);
    assert.equal(db.executions.filter((entry) => entry.sql.startsWith("INSERT INTO outbox_messages")).length, 1);
    const exhausted = new CraftDatabase(); exhausted.failTransactions = 2;
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(exhausted, ids(), 2).execute(craft({ requestKey: "retry-no" })), (error: unknown) => typeof error === "object" && error !== null && "errno" in error && error.errno === 1213);
    assert.equal(exhausted.executions.length, 0);
  });

  it("replays a concurrently committed same-key request after the unique conflict", async () => {
    const db = new CraftDatabase(); db.injectConcurrentDuplicate = true;
    const result = await new MariaCanonicalBuildingRecipeRepository(db, ids(), 3).execute(craft({ requestKey: "concurrent" }));
    assert.deepEqual(result, { craftOperationId: "winner01", replayed: true });
    assert.equal(db.concurrentOperation?.craft_operation_id, "winner01");
    assert.equal(db.concurrentOperation?.craft_recipe_id, "recipe01");
    assert.equal(db.concurrentOperation?.requested_count, 1n);
    assert.match(db.concurrentOperation?.payload_fingerprint ?? "", /^[a-f0-9]{64}$/);
    assert.equal(db.concurrentOperation?.operation_status, "completed");
    assert.deepEqual(db.concurrentCommonOperations, [{ operationId: 901n, status: "completed" }]);
    assert.deepEqual(db.concurrentOutboxMessages, [{ operationId: 901n, craftOperationId: "winner01", playerId: "player01" }]);
    assert.equal(db.concurrentOutboxMessages.length + db.executions.filter((entry) => entry.sql.startsWith("INSERT INTO outbox_messages")).length, 1, "winner and loser aggregate to one outbox row");
    assert.equal(db.operation, undefined, "the losing canonical operation insert rolled back");
    assert.equal(db.stacks.get("stone001")?.quantity, 2n);
    assert.equal(db.stacks.has("box00001"), false);
    assert.equal(db.balances.get("point001")?.amount, 1_000_000_000n);
    for (const prefix of ["INSERT INTO canonical_owned_item_stacks", "UPDATE canonical_owned_item_stacks", "INSERT INTO canonical_craft_item_ledger_entries", "INSERT INTO canonical_player_currency_balances", "UPDATE canonical_player_currency_balances", "INSERT INTO canonical_craft_currency_ledger_entries", "INSERT INTO operations", "UPDATE operations", "INSERT INTO outbox_messages"]) {
      assert.equal(db.executions.filter((entry) => entry.sql.startsWith(prefix)).length, 0, `loser must not persist ${prefix}`);
    }
    assert.equal(db.executions.length, 0, "the replaying loser leaves no committed mutation");
  });

  it("retries ER_LOCK_WAIT_TIMEOUT and rejects an oversized batch before mutation", async () => {
    const timeout = new CraftDatabase(); timeout.failTransactions = 1;
    const original = timeout.withTransaction.bind(timeout); let first = true;
    timeout.withTransaction = async <T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> => { if (first) { first = false; timeout.failTransactions = 0; throw { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }; } return original(work); };
    assert.equal((await new MariaCanonicalBuildingRecipeRepository(timeout, ids(), 2).execute(craft({ requestKey: "timeout" }))).replayed, false);
    assert.equal(timeout.executions.filter((entry) => entry.sql.startsWith("INSERT INTO outbox_messages")).length, 1);
    const limited = new CraftDatabase();
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(limited, ids()).execute(craft({ requestedCount: 11n, requestKey: "limit" })), /BATCH_LIMIT_EXCEEDED/);
    assert.equal(limited.stacks.get("stone001")?.quantity, 2n);
  });

  it("leaves balances untouched for inactive, over-limit, and insufficient recipes", async () => {
    const inactive = new CraftDatabase(); inactive.recipe.active_flag = 0;
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(inactive, ids()).execute(craft({ requestKey: "inactive" })), /RECIPE_INACTIVE/);
    assert.equal(inactive.stacks.get("stone001")?.quantity, 2n);
    const insufficient = new CraftDatabase(); insufficient.balances.get("point001")!.amount = 1n;
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(insufficient, ids()).execute(craft({ requestKey: "short" })), /INSUFFICIENT_CURRENCY/);
    assert.equal(insufficient.stacks.get("stone001")?.quantity, 2n);
    assert.equal(insufficient.balances.get("point001")?.amount, 1n);
  });

  it("rolls back item, currency, operation, ledger, and outbox together when outbox persistence fails", async () => {
    const db = new CraftDatabase(); db.failOutbox = true;
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(db, ids()).execute(craft({ requestKey: "outbox-fail" })), /OUTBOX_WRITE_FAILED/);
    assert.equal(db.executions.length, 0);
    assert.equal(db.operation, undefined);
    assert.equal(db.stacks.get("stone001")?.quantity, 2n);
    assert.equal(db.stacks.has("box00001"), false);
    assert.equal(db.balances.get("point001")?.amount, 1_000_000_000n);
  });

  it("rejects signed BIGINT ledger overflow for every typed input/output before any write", async () => {
    const max = 9_223_372_036_854_775_807n;
    const cases: Array<{ label: string; amount: bigint; count: bigint; configure: (db: CraftDatabase, amount: bigint) => void }> = [];
    for (const [label, configure] of [
      ["item-input", (db: CraftDatabase, amount: bigint) => { db.itemInputs = [{ target_id: "stone001", amount }]; }],
      ["item-output", (db: CraftDatabase, amount: bigint) => { db.itemOutputs = [{ target_id: "box00001", amount }]; }],
      ["currency-input", (db: CraftDatabase, amount: bigint) => { db.currencyInputs = [{ target_id: "point001", amount }]; }],
      ["currency-output", (db: CraftDatabase, amount: bigint) => { db.currencyOutputs = [{ target_id: "coin0001", amount }]; }],
    ] as const) {
      cases.push({ label: `${label}-max-times-two`, amount: max, count: 2n, configure });
      cases.push({ label: `${label}-max-plus-one`, amount: max + 1n, count: 1n, configure });
    }
    for (const scenario of cases) {
      const db = new CraftDatabase(); db.recipe.maximum_batch_count = 2n; scenario.configure(db, scenario.amount);
      await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(db, ids()).execute(craft({ requestKey: scenario.label, requestedCount: scenario.count })), /LEDGER_DELTA_OUT_OF_RANGE/);
      assert.equal(db.executions.length, 0, scenario.label);
      assert.equal(db.operation, undefined, scenario.label);
    }
  });

  it("pins composite owner/target foreign keys against cross-owner ledger rows", () => {
    const migration = readFileSync(new URL("../migrations/453_canonical_building_recipe.sql", import.meta.url), "utf8");
    for (const token of ["FOREIGN KEY (craft_operation_id, player_id)", "FOREIGN KEY (owned_item_stack_id, player_id, item_id)", "FOREIGN KEY (player_currency_balance_id, player_id, currency_id)", "uq_canonical_owned_item_stack_owner_target", "request_key VARCHAR(182)", "ALTER TABLE outbox_messages", "fk_outbox_canonical_craft_owner"]) assert.ok(migration.includes(token));
    assert.doesNotMatch(migration, /FOREIGN KEY \(owned_item_stack_id\) REFERENCES|FOREIGN KEY \(player_currency_balance_id\) REFERENCES/);
  });

  it("accepts the 182-character request-key boundary and fails closed for building execution", async () => {
    const db = new CraftDatabase(); const repository = new MariaCanonicalBuildingRecipeRepository(db, ids());
    await repository.execute(craft({ requestKey: "r".repeat(182) }));
    await assert.rejects(() => repository.execute(craft({ requestKey: "r".repeat(183) })), /REQUEST_KEY_INVALID/);
    const building = new CraftDatabase(); building.recipe.craft_recipe_kind = "building_upgrade";
    await assert.rejects(() => new MariaCanonicalBuildingRecipeRepository(building, ids()).execute(craft({ requestKey: "building" })), /BUILDING_EXECUTION_REQUIRES_HOME_PROVIDER/);
    assert.equal(building.stacks.get("stone001")?.quantity, 2n);
  });
});
