import { hasRootTransactionCapability, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { OBJECT_IDENTITY_MAX_ATTEMPTS, assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectAuditValues, type ObjectIdentityCandidateGenerator } from "../identity/object-identity-audit-provider.js";
import { insertWithCuid8CollisionRetry, isMariaBusinessUniqueConflict, withMariaTransactionRetry } from "../shared/maria-database-error-policy.js";

export type CanonicalItemDefinitionInput = {
  actor: string;
  sourceSystem: string;
  sourceNamespace: string;
  sourceIdentifier: string;
  itemName: string;
  itemDescription?: string | null;
  itemKind: string;
  itemGrade?: string | null;
  priceAmount?: string | null;
  // WBS740 canonical currency FK가 준비되기 전 레거시 재화 source 식별자만 보존합니다.
  priceCurrencySourceIdentifier?: string | null;
  stackable: boolean;
  active?: boolean;
  definitionOptions?: Record<string, unknown> | null;
};

export type CanonicalItemStackChange = {
  actor: string;
  playerId: string;
  itemId: string;
  requestKey: string;
  quantityDelta: bigint;
  reasonType: string;
};

export type CanonicalItemStackChangeResult = {
  quantity: bigint;
  replayed: boolean;
};

type PlayerRow = { player_id: string };
type DefinitionImportRow = { item_id: string };
type OperationRow = {
  item_inventory_operation_id: string;
  operation_status: string;
  resulting_quantity: bigint | string | null;
  ledger_entry_id: string | null;
  ledger_player_id: string | null;
  ledger_item_id: string | null;
  owned_item_stack_id: string | null;
  owned_item_id: string | null;
  quantity_delta: bigint | string | null;
  reason_type: string | null;
  ledger_count: bigint | string;
};
type StackRow = { owned_item_stack_id: string; quantity: bigint };
type ActiveStackableDefinitionRow = { item_id: string };

const STACK_TRANSACTION_MAX_ATTEMPTS = 3;
const STACK_REPLAY_READ_ATTEMPTS = 3;
const STACK_REPLAY_READ_DELAY_MS = 30;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const MIN_SIGNED_BIGINT = -9_223_372_036_854_775_808n;
const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;
const OPERATION_UNIQUE = "uq_canonical_item_inventory_operations_player_request";
const STACK_UNIQUE = "uq_canonical_owned_item_stacks_player_item";

function duplicateKey(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  if (code !== "ER_DUP_ENTRY" && !/duplicate entry/i.test(message)) return null;
  return /for key ['`]?([^'`\s]+)['`]?/i.exec(message)?.[1] ?? "UNKNOWN";
}

// PK 충돌만 CUID 후보 재시도 대상으로 취급하고 업무 UNIQUE 충돌은 호출자에게 돌려줍니다.
function isPrimaryKeyDuplicate(error: unknown): boolean {
  const key = duplicateKey(error);
  return key !== null && (key === "PRIMARY" || /_pkey$/i.test(key));
}

// source/request/stack UNIQUE 충돌은 커밋한 선행 transaction을 재조회하는 멱등성 경계입니다.
function isBusinessUniqueDuplicate(error: unknown): boolean {
  const key = duplicateKey(error);
  return key !== null && !isPrimaryKeyDuplicate(error);
}

function assertText(value: string, name: string, maxLength: number): void {
  if (value.trim() === "" || value.length > maxLength) throw new Error(`CANONICAL_ITEM_${name}_INVALID`);
}

function auditValues(actor: string, now: () => Date): ObjectAuditValues {
  return createObjectAuditValues(actor, now());
}

// 공용 CUID2 후보 정책과 동일하게 PK 충돌을 검출해 제한된 횟수만 재시도합니다.
async function insertWithCuidRetry(
  insert: (candidate: string) => Promise<void>,
  generate: ObjectIdentityCandidateGenerator,
  maxAttempts: number
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generate();
    assertObjectIdentityCandidate(candidate);
    try {
      await insert(candidate);
      return candidate;
    } catch (error) {
      if (!isPrimaryKeyDuplicate(error)) throw error;
    }
  }
  throw new Error("CANONICAL_ITEM_CUID_COLLISION_RETRY_EXHAUSTED");
}

// 표준 canonical item 정의·수량 보유·인스턴스 보유의 별도 전환 경로를 제공합니다.
export class CanonicalItemInventoryRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly generate: ObjectIdentityCandidateGenerator = createObjectIdentityCandidate,
    private readonly maxAttempts = OBJECT_IDENTITY_MAX_ATTEMPTS,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("CANONICAL_ITEM_MAX_ATTEMPTS_INVALID");
  }

  async registerPlayer(input: { actor: string; sourceSystem: string; sourceIdentifier: string }): Promise<{ playerId: string; replayed: boolean }> {
    assertText(input.sourceSystem, "SOURCE_SYSTEM", 50);
    assertText(input.sourceIdentifier, "SOURCE_IDENTIFIER", 191);
    const audit = auditValues(input.actor, this.now);
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => {
          const existing = (await transaction.query<PlayerRow[]>(
        "SELECT player_id FROM canonical_players WHERE source_system=? AND source_identifier=? FOR UPDATE",
        [input.sourceSystem, input.sourceIdentifier]
          ))[0];
          if (existing !== undefined) return { playerId: existing.player_id, replayed: true };
          const playerId = await insertWithCuidRetry((candidate) => transaction.execute(
        "INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?)",
        [candidate, input.sourceSystem, input.sourceIdentifier, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
          ).then(() => undefined), this.generate, this.maxAttempts);
          return { playerId, replayed: false };
        });
      } catch (error) {
        if (!isBusinessUniqueDuplicate(error) || attempt + 1 === this.maxAttempts) throw error;
      }
    }
    throw new Error("CANONICAL_ITEM_PLAYER_REGISTER_RETRY_EXHAUSTED");
  }

  async registerDefinition(input: CanonicalItemDefinitionInput): Promise<{ itemId: string; replayed: boolean }> {
    assertText(input.sourceSystem, "SOURCE_SYSTEM", 50);
    assertText(input.sourceNamespace, "SOURCE_NAMESPACE", 100);
    assertText(input.sourceIdentifier, "SOURCE_IDENTIFIER", 191);
    assertText(input.itemName, "NAME", 255);
    assertText(input.itemKind, "KIND", 50);
    const audit = auditValues(input.actor, this.now);
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => {
      const existing = (await transaction.query<DefinitionImportRow[]>(
        "SELECT item_id FROM canonical_item_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE",
        [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
      ))[0];
      if (existing !== undefined) return { itemId: existing.item_id, replayed: true };
      const itemId = await insertWithCuidRetry((candidate) => transaction.execute(
        "INSERT INTO canonical_item_definitions(item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_source_identifier,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [candidate, input.itemName, input.itemDescription ?? null, input.itemKind, input.itemGrade ?? null, input.priceAmount ?? null, input.priceCurrencySourceIdentifier ?? null, input.stackable, input.active ?? true, input.definitionOptions === undefined ? null : JSON.stringify(input.definitionOptions), audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      ).then(() => undefined), this.generate, this.maxAttempts);
      await insertWithCuidRetry((candidate) => transaction.execute(
        "INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)",
        [candidate, itemId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      ).then(() => undefined), this.generate, this.maxAttempts);
          return { itemId, replayed: false };
        });
      } catch (error) {
        if (!isBusinessUniqueDuplicate(error) || attempt + 1 === this.maxAttempts) throw error;
      }
    }
    throw new Error("CANONICAL_ITEM_DEFINITION_REGISTER_RETRY_EXHAUSTED");
  }

  async changeStackQuantity(input: CanonicalItemStackChange): Promise<CanonicalItemStackChangeResult> {
    assertText(input.requestKey, "REQUEST_KEY", 191);
    try { assertObjectIdentityCandidate(input.playerId); assertObjectIdentityCandidate(input.itemId); }
    catch { throw new Error("CANONICAL_ITEM_ID_INVALID"); }
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(input.reasonType)) throw new Error("CANONICAL_ITEM_REASON_TYPE_INVALID");
    if (typeof input.quantityDelta !== "bigint" || input.quantityDelta < MIN_SIGNED_BIGINT || input.quantityDelta > MAX_SIGNED_BIGINT) throw new Error("CANONICAL_ITEM_QUANTITY_DELTA_INVALID");
    if (input.quantityDelta === 0n) throw new Error("CANONICAL_ITEM_QUANTITY_DELTA_ZERO");
    const audit = auditValues(input.actor, this.now);
    const ownsRootTransaction = hasRootTransactionCapability(this.database);
    for (let attempt = 0; attempt < STACK_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await withMariaTransactionRetry(this.database, {
          maxAttempts: STACK_TRANSACTION_MAX_ATTEMPTS,
          allowCheckReadConflict: true,
          allowRetry: (kind) => kind === "TRANSACTION_DEADLOCK" || kind === "TRANSACTION_LOCK_WAIT_TIMEOUT" || kind === "TRANSACTION_CHECK_READ_CONFLICT",
          exhaustedErrorCode: "CANONICAL_ITEM_STACK_TRANSACTION_RETRY_EXHAUSTED",
        }, async (transaction) => this.changeStackInTransaction(transaction, input, audit));
      } catch (error) {
        if (isMariaBusinessUniqueConflict(error, OPERATION_UNIQUE)) {
          // current transaction에서는 선행 lock까지 포함한 상위 owner가 전체 transaction을 재시도해야 합니다.
          if (!ownsRootTransaction) throw error;
          const replay = await this.findConcurrentReplay(input);
          if (replay !== undefined) return replay;
          throw error;
        }
        // 첫 stack 경쟁은 operation insert까지 함께 rollback한 새 root transaction에서만 재시도합니다.
        if (!isMariaBusinessUniqueConflict(error, STACK_UNIQUE) || !ownsRootTransaction || attempt + 1 === STACK_TRANSACTION_MAX_ATTEMPTS) throw error;
      }
    }
    throw new Error("CANONICAL_ITEM_OPERATION_RETRY_EXHAUSTED");
  }

  private async changeStackInTransaction(transaction: DatabaseTransaction, input: CanonicalItemStackChange, audit: ObjectAuditValues): Promise<CanonicalItemStackChangeResult> {
    const existingRows = await transaction.query<OperationRow[]>(
      `SELECT operation.item_inventory_operation_id,operation.operation_status,operation.resulting_quantity,
        ledger.item_inventory_ledger_entry_id ledger_entry_id,ledger.player_id ledger_player_id,ledger.item_id ledger_item_id,
        ledger.owned_item_stack_id,ledger.owned_item_id,ledger.quantity_delta,ledger.reason_type,
        (SELECT COUNT(*) FROM canonical_item_inventory_ledger_entries counted WHERE counted.item_inventory_operation_id=operation.item_inventory_operation_id) ledger_count
       FROM canonical_item_inventory_operations operation
       LEFT JOIN canonical_item_inventory_ledger_entries ledger ON ledger.item_inventory_operation_id=operation.item_inventory_operation_id
       WHERE operation.player_id=? AND operation.request_key=? FOR UPDATE`,
      [input.playerId, input.requestKey]
    );
    if (existingRows.length > 0) return this.requireExactReplay(existingRows, input);
    const player = (await transaction.query<PlayerRow[]>("SELECT player_id FROM canonical_players WHERE player_id=? FOR UPDATE", [input.playerId]))[0];
    if (player === undefined) throw new Error("CANONICAL_ITEM_PLAYER_NOT_FOUND");
    const definition = (await transaction.query<ActiveStackableDefinitionRow[]>(
      "SELECT item_id FROM canonical_item_definitions WHERE item_id=? AND active_flag=TRUE AND stackable_flag=TRUE FOR UPDATE",
      [input.itemId]
    ))[0];
    if (definition === undefined) throw new Error("CANONICAL_ITEM_STACKABLE_DEFINITION_NOT_FOUND");
    const stack = (await transaction.query<StackRow[]>(
      "SELECT owned_item_stack_id,quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
      [input.playerId, input.itemId]
    ))[0];
    const previousQuantity = BigInt(stack?.quantity ?? 0n);
    const quantity = previousQuantity + input.quantityDelta;
    if (quantity < 0n) throw new Error("CANONICAL_ITEM_INSUFFICIENT_QUANTITY");
    if (quantity > MAX_UNSIGNED_BIGINT) throw new Error("CANONICAL_ITEM_QUANTITY_OVERFLOW");
    const operationId = await insertWithCuid8CollisionRetry((candidate) => transaction.execute(
      "INSERT INTO canonical_item_inventory_operations(item_inventory_operation_id,player_id,request_key,operation_status,resulting_quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'processing',NULL,?,?,?,?)",
      [candidate, input.playerId, input.requestKey, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
    ).then(() => undefined), { generate: this.generate, maxAttempts: Math.min(this.maxAttempts, OBJECT_IDENTITY_MAX_ATTEMPTS), exhaustedErrorCode: "CANONICAL_ITEM_OPERATION_ID_COLLISION_RETRY_EXHAUSTED" });
    let stackId: string;
    if (stack === undefined) {
      stackId = await insertWithCuid8CollisionRetry((candidate) => transaction.execute(
        "INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?)",
        [candidate, input.playerId, input.itemId, quantity, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      ).then(() => undefined), { generate: this.generate, maxAttempts: Math.min(this.maxAttempts, OBJECT_IDENTITY_MAX_ATTEMPTS), exhaustedErrorCode: "CANONICAL_ITEM_STACK_ID_COLLISION_RETRY_EXHAUSTED" });
    } else {
      stackId = stack.owned_item_stack_id;
      const changed = await transaction.execute(
        "UPDATE canonical_owned_item_stacks SET quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_item_stack_id=? AND player_id=? AND item_id=?",
        [quantity, audit.UPDATE_USER, audit.UPDATE_TIME, stackId, input.playerId, input.itemId]
      );
      if (changed.affectedRows !== 1n) throw new Error("CANONICAL_ITEM_STACK_UPDATE_CONFLICT");
    }
    await insertWithCuid8CollisionRetry((candidate) => transaction.execute(
      "INSERT INTO canonical_item_inventory_ledger_entries(item_inventory_ledger_entry_id,item_inventory_operation_id,player_id,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?)",
      [candidate, operationId, input.playerId, input.itemId, stackId, input.quantityDelta, input.reasonType, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
    ).then(() => undefined), { generate: this.generate, maxAttempts: Math.min(this.maxAttempts, OBJECT_IDENTITY_MAX_ATTEMPTS), exhaustedErrorCode: "CANONICAL_ITEM_LEDGER_ID_COLLISION_RETRY_EXHAUSTED" });
    const completed = await transaction.execute(
      "UPDATE canonical_item_inventory_operations SET operation_status='completed',resulting_quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE item_inventory_operation_id=?",
      [quantity, audit.UPDATE_USER, audit.UPDATE_TIME, operationId]
    );
    if (completed.affectedRows !== 1n) throw new Error("CANONICAL_ITEM_OPERATION_COMPLETE_CONFLICT");
    return { quantity, replayed: false };
  }

  private requireExactReplay(rows: readonly OperationRow[], input: CanonicalItemStackChange): CanonicalItemStackChangeResult {
    const row = rows[0];
    if (rows.length !== 1 || row === undefined || row.operation_status !== "completed" || BigInt(row.ledger_count) !== 1n
      || row.resulting_quantity === null || row.ledger_entry_id === null || row.ledger_player_id !== input.playerId
      || row.ledger_item_id !== input.itemId || row.owned_item_stack_id === null || row.owned_item_id !== null
      || row.quantity_delta === null || BigInt(row.quantity_delta) !== input.quantityDelta || row.reason_type !== input.reasonType) {
      throw new Error("CANONICAL_ITEM_REPLAY_CORRUPTED");
    }
    try { assertObjectIdentityCandidate(row.item_inventory_operation_id); assertObjectIdentityCandidate(row.ledger_entry_id); assertObjectIdentityCandidate(row.owned_item_stack_id); }
    catch { throw new Error("CANONICAL_ITEM_REPLAY_CORRUPTED"); }
    const quantity = BigInt(row.resulting_quantity);
    if (quantity < 0n || quantity > MAX_UNSIGNED_BIGINT) throw new Error("CANONICAL_ITEM_REPLAY_CORRUPTED");
    return { quantity, replayed: true };
  }

  private async findConcurrentReplay(input: CanonicalItemStackChange): Promise<CanonicalItemStackChangeResult | undefined> {
    for (let attempt = 0; attempt < STACK_REPLAY_READ_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, STACK_REPLAY_READ_DELAY_MS * attempt));
      const rows = await this.database.query<OperationRow[]>(
        `SELECT operation.item_inventory_operation_id,operation.operation_status,operation.resulting_quantity,
          ledger.item_inventory_ledger_entry_id ledger_entry_id,ledger.player_id ledger_player_id,ledger.item_id ledger_item_id,
          ledger.owned_item_stack_id,ledger.owned_item_id,ledger.quantity_delta,ledger.reason_type,
          (SELECT COUNT(*) FROM canonical_item_inventory_ledger_entries counted WHERE counted.item_inventory_operation_id=operation.item_inventory_operation_id) ledger_count
         FROM canonical_item_inventory_operations operation
         LEFT JOIN canonical_item_inventory_ledger_entries ledger ON ledger.item_inventory_operation_id=operation.item_inventory_operation_id
         WHERE operation.player_id=? AND operation.request_key=?`,
        [input.playerId, input.requestKey]
      );
      if (rows.length > 0) return this.requireExactReplay(rows, input);
    }
    return undefined;
  }
}
