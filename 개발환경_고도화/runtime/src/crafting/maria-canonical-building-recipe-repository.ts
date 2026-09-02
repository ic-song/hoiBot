import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { OBJECT_IDENTITY_MAX_ATTEMPTS, assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectIdentityCandidateGenerator } from "../identity/object-identity-audit-provider.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
type TargetAmount = { targetId: string; amount: bigint };
export type CanonicalRecipeDefinitionInput = {
  actor: string; sourceSystem: string; sourceNamespace: string; sourceIdentifier: string;
  recipeName: string; recipeKind: "item_exchange" | "building_upgrade"; maximumBatchCount: bigint;
  itemInputs: readonly TargetAmount[]; currencyInputs: readonly TargetAmount[];
  itemOutputs: readonly TargetAmount[]; currencyOutputs: readonly TargetAmount[];
  buildingId?: string; active?: boolean;
};
export type CanonicalBuildingDefinitionInput = {
  actor: string; sourceSystem: string; sourceNamespace: string; sourceIdentifier: string;
  buildingName: string; floorValue: number; experienceRequired: bigint; active?: boolean;
};
export type CanonicalCraftExecutionInput = { actor: string; playerId: string; craftRecipeId: string; requestedCount: bigint; requestKey: string; destinationId: string; replyText: string };
export type CanonicalCraftExecutionResult = { craftOperationId: string; replayed: boolean };

type ImportRow = { definition_id: string; payload_fingerprint: string };
type RecipeRow = { active_flag: boolean | number; maximum_batch_count: bigint; craft_recipe_kind: string };
type RecipeAmountRow = { target_id: string; amount: bigint };
type OperationRow = { craft_operation_id: string; craft_recipe_id: string; requested_count: bigint; payload_fingerprint: string; operation_status: string };
type StackRow = { owned_item_stack_id: string; quantity: bigint };
type BalanceRow = { player_currency_balance_id: string; balance_minor_amount: bigint };
type RecipePlan = { inputs: Map<string, bigint>; deltas: Map<string, bigint> };

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function text(value: string, maximum: number, code: string): void { if (value.trim() === "" || value.length > maximum) throw new Error(code); }
function sourceToken(value: string, maximum: number, code: string): void { text(value, maximum, code); if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(code); }
function identifier(value: string): void { try { assertObjectIdentityCandidate(value); } catch { throw new Error("CANONICAL_CRAFT_IDENTIFIER_INVALID"); } }
function duplicate(error: unknown): boolean { return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message)))); }
function primaryDuplicate(error: unknown): boolean {
  if (!duplicate(error)) return false;
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  const key = /for key ['`]?([^'`\s]+)['`]?/i.exec(message)?.[1];
  return key === "PRIMARY" || (key !== undefined && /_pkey$/i.test(key));
}
function retryable(error: unknown): boolean {
  if (duplicate(error)) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const errno = "errno" in error ? Number(error.errno) : Number.NaN;
  return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT" || errno === 1213 || errno === 1205;
}
function multiplied(amount: bigint, count: bigint): bigint {
  if (amount < 1n || count < 1n || amount > UINT64_MAX / count) throw new Error("CANONICAL_CRAFT_AMOUNT_OVERFLOW");
  const result = amount * count;
  if (result > SIGNED_BIGINT_MAX) throw new Error("CANONICAL_CRAFT_LEDGER_DELTA_OUT_OF_RANGE");
  return result;
}
function normalizedTargets(rows: readonly TargetAmount[], label: string): TargetAmount[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    identifier(row.targetId);
    if (row.amount < 1n || row.amount > UINT64_MAX) throw new Error(`CANONICAL_CRAFT_${label}_AMOUNT_INVALID`);
    if (seen.has(row.targetId)) throw new Error(`CANONICAL_CRAFT_${label}_DUPLICATE_TARGET`);
    seen.add(row.targetId);
    return { targetId: row.targetId, amount: row.amount };
  }).sort((a, b) => a.targetId.localeCompare(b.targetId));
}
function assertDisjointTargets(inputs: readonly TargetAmount[], outputs: readonly TargetAmount[], label: string): void {
  const inputIds = new Set(inputs.map((row) => row.targetId));
  if (outputs.some((row) => inputIds.has(row.targetId))) throw new Error(`CANONICAL_CRAFT_${label}_INPUT_OUTPUT_OVERLAP`);
}
function payload(input: CanonicalCraftExecutionInput): string { return hash([input.playerId, input.craftRecipeId, input.requestedCount.toString(), input.destinationId, input.replyText]); }

export class MariaCanonicalBuildingRecipeRepository {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maximumAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date()
  ) { if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) throw new Error("CANONICAL_CRAFT_MAX_ATTEMPTS_INVALID"); }

  public async registerBuilding(input: CanonicalBuildingDefinitionInput): Promise<{ buildingId: string; replayed: boolean }> {
    sourceToken(input.sourceSystem, 50, "CANONICAL_BUILDING_SOURCE_SYSTEM_INVALID"); sourceToken(input.sourceNamespace, 100, "CANONICAL_BUILDING_SOURCE_NAMESPACE_INVALID");
    text(input.sourceIdentifier, 191, "CANONICAL_BUILDING_SOURCE_IDENTIFIER_INVALID"); text(input.buildingName, 255, "CANONICAL_BUILDING_NAME_INVALID");
    if (!Number.isInteger(input.floorValue) || input.floorValue < 1 || input.floorValue > 4_294_967_295 || input.experienceRequired < 0n || input.experienceRequired > UINT64_MAX) throw new Error("CANONICAL_BUILDING_PROGRESSION_INVALID");
    const fingerprint = hash([input.buildingName, input.floorValue, input.experienceRequired.toString(), input.active ?? true]);
    return this.retry(async () => this.database.withTransaction(async (transaction) => {
      const current = (await transaction.query<ImportRow[]>("SELECT building_id AS definition_id,payload_fingerprint FROM canonical_building_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE", [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]))[0];
      if (current !== undefined) { if (current.payload_fingerprint !== fingerprint) throw new Error("CANONICAL_BUILDING_DEFINITION_PAYLOAD_CONFLICT"); return { buildingId: current.definition_id, replayed: true }; }
      const audit = createObjectAuditValues(input.actor, this.now());
      const buildingId = await this.insertId(transaction, "INSERT INTO canonical_building_definitions(building_id,building_name,floor_value,experience_required,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)", (id) => [id, input.buildingName, input.floorValue, input.experienceRequired, input.active ?? true, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      await this.insertId(transaction, "INSERT INTO canonical_building_definition_imports(building_definition_import_id,building_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", (id) => [id, buildingId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, fingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      return { buildingId, replayed: false };
    }));
  }

  public async registerRecipe(input: CanonicalRecipeDefinitionInput): Promise<{ craftRecipeId: string; replayed: boolean }> {
    sourceToken(input.sourceSystem, 50, "CANONICAL_CRAFT_SOURCE_SYSTEM_INVALID"); sourceToken(input.sourceNamespace, 100, "CANONICAL_CRAFT_SOURCE_NAMESPACE_INVALID");
    text(input.sourceIdentifier, 191, "CANONICAL_CRAFT_SOURCE_IDENTIFIER_INVALID"); text(input.recipeName, 255, "CANONICAL_CRAFT_RECIPE_NAME_INVALID");
    if (input.recipeKind !== "item_exchange" && input.recipeKind !== "building_upgrade") throw new Error("CANONICAL_CRAFT_RECIPE_KIND_INVALID");
    if (input.maximumBatchCount < 1n || input.maximumBatchCount > UINT64_MAX) throw new Error("CANONICAL_CRAFT_MAXIMUM_BATCH_INVALID");
    if (input.buildingId !== undefined) identifier(input.buildingId);
    const itemInputs = normalizedTargets(input.itemInputs, "ITEM_INPUT"); const currencyInputs = normalizedTargets(input.currencyInputs, "CURRENCY_INPUT");
    const itemOutputs = normalizedTargets(input.itemOutputs, "ITEM_OUTPUT"); const currencyOutputs = normalizedTargets(input.currencyOutputs, "CURRENCY_OUTPUT");
    assertDisjointTargets(itemInputs, itemOutputs, "ITEM"); assertDisjointTargets(currencyInputs, currencyOutputs, "CURRENCY");
    if (itemInputs.length + currencyInputs.length === 0) throw new Error("CANONICAL_CRAFT_RECIPE_INPUT_REQUIRED");
    if ((input.recipeKind === "building_upgrade") !== (input.buildingId !== undefined)) throw new Error("CANONICAL_CRAFT_BUILDING_BINDING_INVALID");
    if (input.recipeKind === "item_exchange" && itemOutputs.length + currencyOutputs.length === 0) throw new Error("CANONICAL_CRAFT_RECIPE_OUTPUT_REQUIRED");
    if (input.recipeKind === "building_upgrade" && itemOutputs.length + currencyOutputs.length !== 0) throw new Error("CANONICAL_CRAFT_BUILDING_OUTPUT_MUST_USE_BINDING");
    const serialized = (rows: readonly TargetAmount[]): Array<[string, string]> => rows.map((row) => [row.targetId, row.amount.toString()]);
    const fingerprint = hash([input.recipeName, input.recipeKind, input.maximumBatchCount.toString(), serialized(itemInputs), serialized(currencyInputs), serialized(itemOutputs), serialized(currencyOutputs), input.buildingId ?? null, input.active ?? true]);
    return this.retry(async () => this.database.withTransaction(async (transaction) => {
      const current = (await transaction.query<ImportRow[]>("SELECT craft_recipe_id AS definition_id,payload_fingerprint FROM canonical_craft_recipe_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE", [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]))[0];
      if (current !== undefined) { if (current.payload_fingerprint !== fingerprint) throw new Error("CANONICAL_CRAFT_RECIPE_PAYLOAD_CONFLICT"); return { craftRecipeId: current.definition_id, replayed: true }; }
      const audit = createObjectAuditValues(input.actor, this.now());
      const recipeId = await this.insertId(transaction, "INSERT INTO canonical_craft_recipe_definitions(craft_recipe_id,craft_recipe_name,craft_recipe_kind,maximum_batch_count,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)", (id) => [id, input.recipeName, input.recipeKind, input.maximumBatchCount, input.active ?? true, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      await this.insertId(transaction, "INSERT INTO canonical_craft_recipe_definition_imports(craft_recipe_definition_import_id,craft_recipe_id,source_system,source_namespace,source_identifier,payload_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", (id) => [id, recipeId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, fingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      await this.insertRecipeTargets(transaction, recipeId, itemInputs, "canonical_craft_recipe_item_inputs", "craft_recipe_item_input_id", "item_id", "quantity", audit);
      await this.insertRecipeTargets(transaction, recipeId, currencyInputs, "canonical_craft_recipe_currency_inputs", "craft_recipe_currency_input_id", "currency_id", "amount_minor", audit);
      await this.insertRecipeTargets(transaction, recipeId, itemOutputs, "canonical_craft_recipe_item_outputs", "craft_recipe_item_output_id", "item_id", "quantity", audit);
      await this.insertRecipeTargets(transaction, recipeId, currencyOutputs, "canonical_craft_recipe_currency_outputs", "craft_recipe_currency_output_id", "currency_id", "amount_minor", audit);
      if (input.buildingId !== undefined) await this.insertId(transaction, "INSERT INTO canonical_building_craft_recipes(building_craft_recipe_id,building_id,craft_recipe_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?)", (id) => [id, input.buildingId, recipeId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      return { craftRecipeId: recipeId, replayed: false };
    }));
  }

  public async execute(input: CanonicalCraftExecutionInput): Promise<CanonicalCraftExecutionResult> {
    identifier(input.playerId); identifier(input.craftRecipeId); text(input.requestKey, 182, "CANONICAL_CRAFT_REQUEST_KEY_INVALID");
    text(input.destinationId, 191, "CANONICAL_CRAFT_DESTINATION_INVALID"); text(input.replyText, 10_000, "CANONICAL_CRAFT_REPLY_INVALID");
    if (input.requestedCount < 1n || input.requestedCount > UINT64_MAX) throw new Error("CANONICAL_CRAFT_REQUEST_COUNT_INVALID");
    const fingerprint = payload(input);
    return this.retry(async () => this.database.withTransaction(async (transaction) => {
      const prior = (await transaction.query<OperationRow[]>("SELECT craft_operation_id,craft_recipe_id,requested_count,payload_fingerprint,operation_status FROM canonical_craft_operations WHERE player_id=? AND request_key=? FOR UPDATE", [input.playerId, input.requestKey]))[0];
      if (prior !== undefined) {
        if (prior.craft_recipe_id !== input.craftRecipeId || prior.requested_count !== input.requestedCount || prior.payload_fingerprint !== fingerprint) throw new Error("CANONICAL_CRAFT_REQUEST_PAYLOAD_CONFLICT");
        if (prior.operation_status !== "completed") throw new Error("CANONICAL_CRAFT_REPLAY_INCOMPLETE");
        return { craftOperationId: prior.craft_operation_id, replayed: true };
      }
      const recipe = (await transaction.query<RecipeRow[]>("SELECT active_flag,maximum_batch_count,craft_recipe_kind FROM canonical_craft_recipe_definitions WHERE craft_recipe_id=? FOR UPDATE", [input.craftRecipeId]))[0];
      if (recipe === undefined || (recipe.active_flag !== true && recipe.active_flag !== 1)) throw new Error("CANONICAL_CRAFT_RECIPE_INACTIVE");
      if (input.requestedCount > recipe.maximum_batch_count) throw new Error("CANONICAL_CRAFT_BATCH_LIMIT_EXCEEDED");
      if (recipe.craft_recipe_kind !== "item_exchange") throw new Error("CANONICAL_CRAFT_BUILDING_EXECUTION_REQUIRES_HOME_PROVIDER");
      const itemPlan = await this.recipePlan(transaction, input.craftRecipeId, input.requestedCount, "item");
      const currencyPlan = await this.recipePlan(transaction, input.craftRecipeId, input.requestedCount, "currency");
      if (![...itemPlan.deltas.values(), ...currencyPlan.deltas.values()].some((delta) => delta > 0n)) throw new Error("CANONICAL_CRAFT_OUTPUT_REQUIRED");
      const audit = createObjectAuditValues(input.actor, this.now());
      const operationId = await this.insertId(transaction, "INSERT INTO canonical_craft_operations(craft_operation_id,player_id,craft_recipe_id,request_key,requested_count,payload_fingerprint,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,'processing',?,?,?,?)", (id) => [id, input.playerId, input.craftRecipeId, input.requestKey, input.requestedCount, fingerprint, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
      const commonOperation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,NULL,NULL,'player',NULL,'canonical_craft','processing',UTC_TIMESTAMP(3))", [randomUUID()]);
      for (const [itemId, delta] of [...itemPlan.deltas.entries()].sort()) await this.applyItemDelta(transaction, operationId, input.playerId, itemId, delta, itemPlan.inputs.get(itemId) ?? 0n, audit);
      for (const [currencyId, delta] of [...currencyPlan.deltas.entries()].sort()) await this.applyCurrencyDelta(transaction, operationId, input.playerId, currencyId, delta, currencyPlan.inputs.get(currencyId) ?? 0n, audit);
      await transaction.execute("INSERT INTO outbox_messages(operation_id,craft_operation_id,player_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,?,?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [commonOperation.insertId, operationId, input.playerId, input.destinationId, JSON.stringify({ data: input.replyText })]);
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify({ craftOperationId: operationId }), commonOperation.insertId]);
      await transaction.execute("UPDATE canonical_craft_operations SET operation_status='completed',UPDATE_USER=?,UPDATE_TIME=? WHERE craft_operation_id=?", [audit.UPDATE_USER, audit.UPDATE_TIME, operationId]);
      return { craftOperationId: operationId, replayed: false };
    }));
  }

  private async retry<T>(work: () => Promise<T>): Promise<T> { for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) { try { return await work(); } catch (error) { if (!retryable(error) || attempt + 1 === this.maximumAttempts) throw error; } } throw new Error("CANONICAL_CRAFT_TRANSACTION_RETRY_EXHAUSTED"); }
  private async insertId(transaction: DatabaseTransaction, sql: string, values: (id: string) => readonly unknown[]): Promise<string> {
    for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) { const id = this.generate(); assertObjectIdentityCandidate(id); try { await transaction.execute(sql, values(id)); return id; } catch (error) { if (!primaryDuplicate(error) || attempt + 1 === this.maximumAttempts) throw error; } }
    throw new Error("CANONICAL_CRAFT_CUID_RETRY_EXHAUSTED");
  }
  private async insertRecipeTargets(transaction: DatabaseTransaction, recipeId: string, rows: readonly TargetAmount[], table: string, primary: string, target: string, amount: string, audit: ReturnType<typeof createObjectAuditValues>): Promise<void> {
    for (const row of rows) await this.insertId(transaction, `INSERT INTO ${table}(${primary},craft_recipe_id,${target},${amount},INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)`, (id) => [id, recipeId, row.targetId, row.amount, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }
  private async recipePlan(transaction: DatabaseTransaction, recipeId: string, count: bigint, kind: "item" | "currency"): Promise<RecipePlan> {
    const target = kind === "item" ? "item_id" : "currency_id"; const amount = kind === "item" ? "quantity" : "amount_minor";
    const inputs = await transaction.query<RecipeAmountRow[]>(`SELECT ${target} AS target_id,${amount} AS amount FROM canonical_craft_recipe_${kind}_inputs WHERE craft_recipe_id=? ORDER BY ${target} FOR UPDATE`, [recipeId]);
    const outputs = await transaction.query<RecipeAmountRow[]>(`SELECT ${target} AS target_id,${amount} AS amount FROM canonical_craft_recipe_${kind}_outputs WHERE craft_recipe_id=? ORDER BY ${target} FOR UPDATE`, [recipeId]);
    const deltas = new Map<string, bigint>(); const required = new Map<string, bigint>();
    for (const row of inputs) { const value = multiplied(row.amount, count); required.set(row.target_id, value); deltas.set(row.target_id, (deltas.get(row.target_id) ?? 0n) - value); }
    for (const row of outputs) deltas.set(row.target_id, (deltas.get(row.target_id) ?? 0n) + multiplied(row.amount, count));
    for (const [key, value] of deltas) {
      if (value > SIGNED_BIGINT_MAX || value < -SIGNED_BIGINT_MAX) throw new Error("CANONICAL_CRAFT_LEDGER_DELTA_OUT_OF_RANGE");
      if (value === 0n) deltas.delete(key);
    }
    return { inputs: required, deltas };
  }
  private async applyItemDelta(transaction: DatabaseTransaction, operationId: string, playerId: string, itemId: string, delta: bigint, required: bigint, audit: ReturnType<typeof createObjectAuditValues>): Promise<void> {
    const row = (await transaction.query<StackRow[]>("SELECT owned_item_stack_id,quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [playerId, itemId]))[0];
    const current = row?.quantity ?? 0n; if (current < required) throw new Error("CANONICAL_CRAFT_INSUFFICIENT_ITEM");
    const next = current + delta; if (next < 0n || next > UINT64_MAX) throw new Error("CANONICAL_CRAFT_INSUFFICIENT_ITEM");
    const stackId = row?.owned_item_stack_id ?? await this.insertId(transaction, "INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,0,?,?,?,?)", (id) => [id, playerId, itemId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    await transaction.execute("UPDATE canonical_owned_item_stacks SET quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_item_stack_id=?", [next, audit.UPDATE_USER, audit.UPDATE_TIME, stackId]);
    await this.insertId(transaction, "INSERT INTO canonical_craft_item_ledger_entries(craft_item_ledger_entry_id,craft_operation_id,player_id,item_id,owned_item_stack_id,quantity_delta,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", (id) => [id, operationId, playerId, itemId, stackId, delta, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }
  private async applyCurrencyDelta(transaction: DatabaseTransaction, operationId: string, playerId: string, currencyId: string, delta: bigint, required: bigint, audit: ReturnType<typeof createObjectAuditValues>): Promise<void> {
    const row = (await transaction.query<BalanceRow[]>("SELECT player_currency_balance_id,balance_minor_amount FROM canonical_player_currency_balances WHERE player_id=? AND currency_id=? FOR UPDATE", [playerId, currencyId]))[0];
    const current = row?.balance_minor_amount ?? 0n; if (current < required) throw new Error("CANONICAL_CRAFT_INSUFFICIENT_CURRENCY");
    const next = current + delta; if (next < 0n || next > UINT64_MAX) throw new Error("CANONICAL_CRAFT_INSUFFICIENT_CURRENCY");
    const balanceId = row?.player_currency_balance_id ?? await this.insertId(transaction, "INSERT INTO canonical_player_currency_balances(player_currency_balance_id,player_id,currency_id,balance_minor_amount,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,0,?,?,?,?)", (id) => [id, playerId, currencyId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
    await transaction.execute("UPDATE canonical_player_currency_balances SET balance_minor_amount=?,UPDATE_USER=?,UPDATE_TIME=? WHERE player_currency_balance_id=?", [next, audit.UPDATE_USER, audit.UPDATE_TIME, balanceId]);
    await this.insertId(transaction, "INSERT INTO canonical_craft_currency_ledger_entries(craft_currency_ledger_entry_id,craft_operation_id,player_id,currency_id,player_currency_balance_id,amount_minor_delta,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?)", (id) => [id, operationId, playerId, currencyId, balanceId, delta, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]);
  }
}
