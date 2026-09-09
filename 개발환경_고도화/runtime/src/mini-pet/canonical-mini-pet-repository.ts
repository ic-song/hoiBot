import { createHash } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createScopedDatabaseClient } from "../database.js";
import { createObjectAuditValues, MariaObjectIdentityAuditProvider } from "../identity/object-identity-audit-provider.js";

export const CANONICAL_MINI_PET_REQUEST_KEY_MAX_LENGTH = 182;
const CANONICAL_MINI_PET_TRANSACTION_MAX_ATTEMPTS = 3;

export interface CanonicalMiniPetAcquireInput {
  actor: string;
  playerId: string;
  miniPetId: string;
  requestKey: string;
  bound: boolean;
}

export interface CanonicalMiniPetAcquireResult {
  miniPetOperationId: string;
  ownedMiniPetId: string;
  replayed: boolean;
}

export interface CanonicalMiniPetDefinitionCharm {
  battleCharm: bigint;
  castleCharm: bigint;
  raidCharm: bigint;
}

export interface CanonicalMiniPetEnhancementGain {
  targetEnhancementLevel: number;
  battleCharmGain: bigint;
  castleCharmGain: bigint;
  raidCharmGain: bigint;
}

interface ReplayRow {
  mini_pet_operation_id: string;
  owned_mini_pet_id: string | null;
  operation_kind: string;
  payload_fingerprint: string;
}

interface DefinitionRow { mini_pet_id: string; }
interface OwnedRow { owned_mini_pet_id: string; }

function assertIdentifier(value: string): void {
  if (!/^[a-z][a-z0-9]{7}$/.test(value)) throw new Error("CANONICAL_MINI_PET_IDENTIFIER_INVALID");
}

function assertAcquireInput(input: CanonicalMiniPetAcquireInput): void {
  assertIdentifier(input.playerId);
  assertIdentifier(input.miniPetId);
  // identity sourceIdentifier `${playerId}:${requestKey}`의 VARCHAR(191) 경계를 넘지 않습니다.
  if (input.actor.trim() === "" || input.actor.length > 100 || input.requestKey.trim() === "" || input.requestKey.length > CANONICAL_MINI_PET_REQUEST_KEY_MAX_LENGTH) {
    throw new Error("CANONICAL_MINI_PET_ACQUIRE_INPUT_INVALID");
  }
}

function acquireFingerprint(input: CanonicalMiniPetAcquireInput): string {
  return createHash("sha256").update(JSON.stringify({ operationKind: "acquire", miniPetId: input.miniPetId, bound: input.bound })).digest("hex");
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message))));
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const errno = "errno" in error ? Number(error.errno) : Number.NaN;
  return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT" || errno === 1213 || errno === 1205;
}

export function calculateCanonicalMiniPetCharm(
  base: CanonicalMiniPetDefinitionCharm,
  enhancementLevel: number,
  rules: readonly CanonicalMiniPetEnhancementGain[],
): CanonicalMiniPetDefinitionCharm {
  if (!Number.isInteger(enhancementLevel) || enhancementLevel < 0) throw new Error("CANONICAL_MINI_PET_ENHANCEMENT_LEVEL_INVALID");
  const applicable = rules.filter((rule) => rule.targetEnhancementLevel <= enhancementLevel);
  return applicable.reduce((total, rule) => ({
    battleCharm: total.battleCharm + rule.battleCharmGain,
    castleCharm: total.castleCharm + rule.castleCharmGain,
    raidCharm: total.raidCharm + rule.raidCharmGain,
  }), { ...base });
}

// 같은 정의 미니펫도 획득 요청마다 별도의 owned_mini_pet_id로 저장합니다.
export class MariaCanonicalMiniPetRepository {
  constructor(private readonly database: DatabaseClient, private readonly now: () => Date = () => new Date()) {}

  async acquire(input: CanonicalMiniPetAcquireInput): Promise<CanonicalMiniPetAcquireResult> {
    assertAcquireInput(input);
    for (let attempt = 0; attempt < CANONICAL_MINI_PET_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.withTransaction((transaction) => this.acquireInTransaction(transaction, input));
      } catch (error) {
        if (isDuplicate(error)) {
          const replay = await this.findReplay(input);
          if (replay !== undefined) return replay;
        }
        if (isRetryableTransactionConflict(error) && attempt + 1 < CANONICAL_MINI_PET_TRANSACTION_MAX_ATTEMPTS) continue;
        throw error;
      }
    }
    throw new Error("CANONICAL_MINI_PET_CONCURRENT_RETRY_EXHAUSTED");
  }

  private async acquireInTransaction(transaction: DatabaseTransaction, input: CanonicalMiniPetAcquireInput): Promise<CanonicalMiniPetAcquireResult> {
    const fingerprint = acquireFingerprint(input);
    const prior = (await transaction.query<ReplayRow[]>(
      "SELECT mini_pet_operation_id,owned_mini_pet_id,operation_kind,payload_fingerprint FROM canonical_mini_pet_operation_replays WHERE player_id=? AND request_key=? FOR UPDATE",
      [input.playerId, input.requestKey],
    ))[0];
    if (prior !== undefined) return this.toReplay(prior, fingerprint);
    const definition = (await transaction.query<DefinitionRow[]>(
      "SELECT mini_pet_id FROM canonical_mini_pet_definitions WHERE mini_pet_id=? AND active_flag=TRUE FOR UPDATE",
      [input.miniPetId],
    ))[0];
    if (definition === undefined) throw new Error("CANONICAL_MINI_PET_DEFINITION_NOT_FOUND");

    const identity = new MariaObjectIdentityAuditProvider(createScopedDatabaseClient(transaction));
    const operation = await identity.registerCrosswalk({
      actor: input.actor, objectType: "MINI_PET_OPERATION", sourceSystem: "CANONICAL_RUNTIME",
      sourceNamespace: "miniPetOperation", sourceIdentifier: `${input.playerId}:${input.requestKey}`,
    });
    const owned = await identity.registerCrosswalk({
      actor: input.actor, objectType: "OWNED_MINI_PET", sourceSystem: "CANONICAL_RUNTIME",
      sourceNamespace: "ownedMiniPet", sourceIdentifier: `${input.playerId}:${input.requestKey}`,
    });
    const audit = operation.audit;
    await transaction.execute(
      "INSERT INTO canonical_owned_mini_pet_instances(owned_mini_pet_id,player_id,mini_pet_id,enhancement_level,equipped_flag,bound_flag,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,0,FALSE,?,'owned',?,?,?,?)",
      [owned.objectIdentityId, input.playerId, input.miniPetId, input.bound, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    await transaction.execute(
      "INSERT INTO canonical_mini_pet_operation_replays(mini_pet_operation_id,player_id,request_key,operation_kind,payload_fingerprint,owned_mini_pet_id,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'acquire',?,?,'completed',?,?,?,?)",
      [operation.objectIdentityId, input.playerId, input.requestKey, fingerprint, owned.objectIdentityId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME],
    );
    return { miniPetOperationId: operation.objectIdentityId, ownedMiniPetId: owned.objectIdentityId, replayed: false };
  }

  async equip(input: { actor: string; playerId: string; ownedMiniPetId: string }): Promise<void> {
    assertIdentifier(input.playerId);
    assertIdentifier(input.ownedMiniPetId);
    const audit = createObjectAuditValues(input.actor, this.now());
    await this.database.withTransaction(async (transaction) => {
      await transaction.query<OwnedRow[]>(
        "SELECT owned_mini_pet_id FROM canonical_owned_mini_pet_instances WHERE player_id=? AND ownership_status='owned' FOR UPDATE",
        [input.playerId],
      );
      const target = (await transaction.query<OwnedRow[]>(
        "SELECT owned_mini_pet_id FROM canonical_owned_mini_pet_instances WHERE owned_mini_pet_id=? AND player_id=? AND ownership_status='owned' FOR UPDATE",
        [input.ownedMiniPetId, input.playerId],
      ))[0];
      if (target === undefined) throw new Error("CANONICAL_OWNED_MINI_PET_NOT_FOUND");
      await transaction.execute(
        "UPDATE canonical_owned_mini_pet_instances SET equipped_flag=FALSE,UPDATE_USER=?,UPDATE_TIME=? WHERE player_id=? AND equipped_flag=TRUE",
        [audit.UPDATE_USER, audit.UPDATE_TIME, input.playerId],
      );
      const changed = await transaction.execute(
        "UPDATE canonical_owned_mini_pet_instances SET equipped_flag=TRUE,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_mini_pet_id=? AND player_id=? AND ownership_status='owned'",
        [audit.UPDATE_USER, audit.UPDATE_TIME, input.ownedMiniPetId, input.playerId],
      );
      if (changed.affectedRows !== 1n) throw new Error("CANONICAL_OWNED_MINI_PET_EQUIP_FAILED");
    });
  }

  private async findReplay(input: CanonicalMiniPetAcquireInput): Promise<CanonicalMiniPetAcquireResult | undefined> {
    const row = (await this.database.query<ReplayRow[]>(
      "SELECT mini_pet_operation_id,owned_mini_pet_id,operation_kind,payload_fingerprint FROM canonical_mini_pet_operation_replays WHERE player_id=? AND request_key=?",
      [input.playerId, input.requestKey],
    ))[0];
    return row === undefined ? undefined : this.toReplay(row, acquireFingerprint(input));
  }

  private toReplay(row: ReplayRow, fingerprint: string): CanonicalMiniPetAcquireResult {
    if (row.operation_kind !== "acquire" || row.payload_fingerprint !== fingerprint) throw new Error("CANONICAL_MINI_PET_REQUEST_PAYLOAD_CONFLICT");
    if (row.owned_mini_pet_id === null) throw new Error("CANONICAL_MINI_PET_REPLAY_INCOMPLETE");
    return { miniPetOperationId: row.mini_pet_operation_id, ownedMiniPetId: row.owned_mini_pet_id, replayed: true };
  }
}
