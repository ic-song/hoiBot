import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { OBJECT_IDENTITY_MAX_ATTEMPTS, assertObjectIdentityCandidate, createObjectAuditValues, createObjectIdentityCandidate, type ObjectAuditValues, type ObjectIdentityCandidateGenerator } from "../identity/object-identity-audit-provider.js";

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
  priceCurrencyName?: string | null;
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
type OperationRow = { resulting_quantity: bigint };
type StackRow = { owned_item_stack_id: string; quantity: bigint };

function isDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return ("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message)));
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
      if (!isDuplicate(error)) throw error;
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
    return this.database.withTransaction(async (transaction) => {
      const existing = (await transaction.query<PlayerRow[]>(
        "SELECT player_id FROM canonical_item_players WHERE source_system=? AND source_identifier=? FOR UPDATE",
        [input.sourceSystem, input.sourceIdentifier]
      ))[0];
      if (existing !== undefined) return { playerId: existing.player_id, replayed: true };
      const playerId = await insertWithCuidRetry((candidate) => transaction.execute(
        "INSERT INTO canonical_item_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?)",
        [candidate, input.sourceSystem, input.sourceIdentifier, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      ).then(() => undefined), this.generate, this.maxAttempts);
      return { playerId, replayed: false };
    });
  }

  async registerDefinition(input: CanonicalItemDefinitionInput): Promise<{ itemId: string; replayed: boolean }> {
    assertText(input.sourceSystem, "SOURCE_SYSTEM", 50);
    assertText(input.sourceNamespace, "SOURCE_NAMESPACE", 100);
    assertText(input.sourceIdentifier, "SOURCE_IDENTIFIER", 191);
    assertText(input.itemName, "NAME", 255);
    assertText(input.itemKind, "KIND", 50);
    const audit = auditValues(input.actor, this.now);
    return this.database.withTransaction(async (transaction) => {
      const existing = (await transaction.query<DefinitionImportRow[]>(
        "SELECT item_id FROM canonical_item_definition_imports WHERE source_system=? AND source_namespace=? AND source_identifier=? FOR UPDATE",
        [input.sourceSystem, input.sourceNamespace, input.sourceIdentifier]
      ))[0];
      if (existing !== undefined) return { itemId: existing.item_id, replayed: true };
      const itemId = await insertWithCuidRetry((candidate) => transaction.execute(
        "INSERT INTO canonical_item_definitions(item_id,item_name,item_description,item_kind,item_grade,price_amount,price_currency_name,stackable_flag,active_flag,definition_options,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [candidate, input.itemName, input.itemDescription ?? null, input.itemKind, input.itemGrade ?? null, input.priceAmount ?? null, input.priceCurrencyName ?? null, input.stackable, input.active ?? true, input.definitionOptions === undefined ? null : JSON.stringify(input.definitionOptions), audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      ).then(() => undefined), this.generate, this.maxAttempts);
      await insertWithCuidRetry((candidate) => transaction.execute(
        "INSERT INTO canonical_item_definition_imports(item_definition_import_id,item_id,source_system,source_namespace,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)",
        [candidate, itemId, input.sourceSystem, input.sourceNamespace, input.sourceIdentifier, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
      ).then(() => undefined), this.generate, this.maxAttempts);
      return { itemId, replayed: false };
    });
  }

  async changeStackQuantity(input: CanonicalItemStackChange): Promise<CanonicalItemStackChangeResult> {
    assertText(input.requestKey, "REQUEST_KEY", 191);
    assertText(input.reasonType, "REASON_TYPE", 100);
    if (input.quantityDelta === 0n) throw new Error("CANONICAL_ITEM_QUANTITY_DELTA_ZERO");
    const audit = auditValues(input.actor, this.now);
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => this.changeStackInTransaction(transaction, input, audit));
      } catch (error) {
        if (!isDuplicate(error) || attempt + 1 === this.maxAttempts) throw error;
      }
    }
    throw new Error("CANONICAL_ITEM_OPERATION_RETRY_EXHAUSTED");
  }

  private async changeStackInTransaction(transaction: DatabaseTransaction, input: CanonicalItemStackChange, audit: ObjectAuditValues): Promise<CanonicalItemStackChangeResult> {
    const existing = (await transaction.query<OperationRow[]>(
      "SELECT resulting_quantity FROM canonical_item_inventory_operations WHERE player_id=? AND request_key=? FOR UPDATE",
      [input.playerId, input.requestKey]
    ))[0];
    if (existing !== undefined) return { quantity: existing.resulting_quantity, replayed: true };
    const operationId = await insertWithCuidRetry((candidate) => transaction.execute(
      "INSERT INTO canonical_item_inventory_operations(item_inventory_operation_id,player_id,request_key,operation_status,resulting_quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'processing',NULL,?,?,?,?)",
      [candidate, input.playerId, input.requestKey, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
    ).then(() => undefined), this.generate, this.maxAttempts);
    const stack = (await transaction.query<StackRow[]>(
      "SELECT owned_item_stack_id,quantity FROM canonical_owned_item_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
      [input.playerId, input.itemId]
    ))[0];
    const previousQuantity = stack?.quantity ?? 0n;
    const quantity = previousQuantity + input.quantityDelta;
    if (quantity < 0n) throw new Error("CANONICAL_ITEM_INSUFFICIENT_QUANTITY");
    const stackId = stack?.owned_item_stack_id ?? await insertWithCuidRetry((candidate) => transaction.execute(
      "INSERT INTO canonical_owned_item_stacks(owned_item_stack_id,player_id,item_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,0,?,?,?,?)",
      [candidate, input.playerId, input.itemId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
    ).then(() => undefined), this.generate, this.maxAttempts);
    await transaction.execute(
      "UPDATE canonical_owned_item_stacks SET quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_item_stack_id=?",
      [quantity, audit.UPDATE_USER, audit.UPDATE_TIME, stackId]
    );
    await insertWithCuidRetry((candidate) => transaction.execute(
      "INSERT INTO canonical_item_inventory_ledger_entries(item_inventory_ledger_entry_id,item_inventory_operation_id,player_id,item_id,owned_item_stack_id,owned_item_id,quantity_delta,reason_type,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?)",
      [candidate, operationId, input.playerId, input.itemId, stackId, input.quantityDelta, input.reasonType, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
    ).then(() => undefined), this.generate, this.maxAttempts);
    await transaction.execute(
      "UPDATE canonical_item_inventory_operations SET operation_status='completed',resulting_quantity=?,UPDATE_USER=?,UPDATE_TIME=? WHERE item_inventory_operation_id=?",
      [quantity, audit.UPDATE_USER, audit.UPDATE_TIME, operationId]
    );
    return { quantity, replayed: false };
  }
}
