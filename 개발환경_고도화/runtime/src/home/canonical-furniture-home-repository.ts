import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createHash } from "node:crypto";
import { assertObjectIdentityCandidate, OBJECT_IDENTITY_MAX_ATTEMPTS, type ObjectAuditValues, type ObjectIdentityCandidateGenerator } from "../identity/object-identity-audit-provider.js";
import { insertWithCuid8CollisionRetry, isMariaBusinessUniqueConflict, isMariaTransactionRetryExhaustion, withMariaTransactionRetry } from "../shared/maria-database-error-policy.js";

const GRANT_TRANSACTION_MAX_ATTEMPTS = 3;
const GRANT_REPLAY_READ_ATTEMPTS = 3;
const GRANT_REPLAY_READ_DELAY_MS = 30;
const GRANT_TRANSACTION_RETRY_EXHAUSTED = "CANONICAL_FURNITURE_GRANT_TRANSACTION_RETRY_EXHAUSTED";
const MAX_UNSIGNED_INT = 4_294_967_295n;

export interface CanonicalFurnitureDefinition {
  furnitureId: string;
  displayName: string;
  purchasePrice: bigint;
  baseCharm: bigint;
  charmPerEnhancement: bigint;
}

export interface CanonicalOwnedFurniture {
  ownedFurnitureId: string;
  playerId: string;
  furnitureId: string;
  enhancementLevel: bigint;
  finalCharm: bigint;
  ownershipStatus: string;
}

export interface GrantCanonicalFurnitureInput {
  actor: string;
  playerId: string;
  furnitureId: string;
  enhancementLevel?: bigint;
  idempotencyScope: string;
  idempotencyKey: string;
}

export interface PlaceCanonicalFurnitureInput {
  actor: string;
  playerId: string;
  ownedFurnitureId: string;
  placementOrder: bigint;
  idempotencyScope: string;
  idempotencyKey: string;
}
export interface TransitionCanonicalFurnitureInput {
  actor: string; playerId: string; ownedFurnitureId: string; fromStatus: "bag"|"placed"|"listed"; toStatus: "bag"|"listed"|"sold"|"removed"; listingPrice?: bigint; idempotencyScope: string; idempotencyKey: string;
}

export type CanonicalFurnitureAuditFactory = (actor: string, now: Date) => ObjectAuditValues;

interface ReplayRow { owned_furniture_id: string; result_status: string; operation_kind: string; payload_fingerprint: string; }
interface DefinitionRow { furniture_id: string; display_name: string; purchase_price: bigint; base_charm: bigint; charm_per_enhancement: bigint; active: number; }
interface OwnedRow { owned_furniture_id: string; player_id: string; furniture_id: string; enhancement_level: bigint; base_charm: bigint; charm_per_enhancement: bigint; }

function duplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("code" in error && String(error.code) === "ER_DUP_ENTRY") || ("message" in error && /duplicate entry/i.test(String(error.message))));
}

function assertCuid2Length(value: string): void {
  try { assertObjectIdentityCandidate(value); } catch { throw new Error("CANONICAL_FURNITURE_ID_INVALID"); }
}

function assertPlacementInput(input: PlaceCanonicalFurnitureInput): void {
  assertCuid2Length(input.playerId);
  assertCuid2Length(input.ownedFurnitureId);
  if (input.actor.trim() === "" || input.actor.length > 100) throw new Error("CANONICAL_FURNITURE_ACTOR_INVALID");
  if (input.placementOrder < 0n) throw new Error("CANONICAL_FURNITURE_PLACEMENT_ORDER_INVALID");
  if (input.idempotencyScope.trim() === "" || input.idempotencyScope.length > 100) throw new Error("CANONICAL_FURNITURE_SCOPE_INVALID");
  if (input.idempotencyKey.trim() === "" || input.idempotencyKey.length > 191) throw new Error("CANONICAL_FURNITURE_KEY_INVALID");
}

function assertGrantInput(input: GrantCanonicalFurnitureInput): void {
  assertCuid2Length(input.playerId);
  assertCuid2Length(input.furnitureId);
  if (input.actor.trim() === "" || input.actor.length > 100) throw new Error("CANONICAL_FURNITURE_ACTOR_INVALID");
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(input.idempotencyScope)) throw new Error("CANONICAL_FURNITURE_SCOPE_INVALID");
  if (input.idempotencyKey.trim() === "" || input.idempotencyKey.length > 191) throw new Error("CANONICAL_FURNITURE_KEY_INVALID");
  if (input.enhancementLevel !== undefined && (input.enhancementLevel < 0n || input.enhancementLevel > MAX_UNSIGNED_INT)) throw new Error("CANONICAL_FURNITURE_ENHANCEMENT_INVALID");
}

// 정의값과 인스턴스 강화 단계만으로 최종 매력을 계산하며 결과를 저장하지 않습니다.
export function calculateCanonicalFurnitureCharm(baseCharm: bigint, charmPerEnhancement: bigint, enhancementLevel: bigint): bigint {
  if (enhancementLevel < 0n) throw new Error("CANONICAL_FURNITURE_ENHANCEMENT_INVALID");
  return baseCharm + charmPerEnhancement * enhancementLevel;
}

function owned(row: OwnedRow, ownershipStatus = "bag"): CanonicalOwnedFurniture {
  return {
    ownedFurnitureId: row.owned_furniture_id,
    playerId: row.player_id,
    furnitureId: row.furniture_id,
    enhancementLevel: BigInt(row.enhancement_level),
    finalCharm: calculateCanonicalFurnitureCharm(BigInt(row.base_charm), BigInt(row.charm_per_enhancement), BigInt(row.enhancement_level)),
    ownershipStatus
  };
}

async function reserveId(transaction: DatabaseTransaction, generate: ObjectIdentityCandidateGenerator, insert: (candidate: string) => Promise<void>, retryDuplicate = true): Promise<string> {
  for (let attempt = 0; attempt < OBJECT_IDENTITY_MAX_ATTEMPTS; attempt += 1) {
    const candidate = generate();
    assertCuid2Length(candidate);
    try { await insert(candidate); return candidate; } catch (error) { if (!retryDuplicate || !isPrimaryDuplicate(error)) throw error; }
  }
  throw new Error("CANONICAL_FURNITURE_ID_COLLISION_RETRY_EXHAUSTED");
}

function duplicateKeyName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined;
  const matched = /(?:for key|key)\s+['`]?([^'`\s]+)/i.exec(String(error.message));
  return matched === null ? undefined : matched[1];
}

function isPrimaryDuplicate(error: unknown): boolean {
  return duplicateKeyName(error)?.toUpperCase() === "PRIMARY";
}

function isOperationReplayUniqueDuplicate(error: unknown): boolean {
  return duplicateKeyName(error)?.toLowerCase() === "uq_object_furniture_operation_replay";
}

const operationReplayBusinessDuplicates = new WeakSet<object>();

function markOperationReplayBusinessDuplicate(error: unknown): void {
  if (typeof error === "object" && error !== null) operationReplayBusinessDuplicates.add(error);
}

function isOperationReplayBusinessDuplicate(error: unknown): boolean {
  return isOperationReplayUniqueDuplicate(error) || (typeof error === "object" && error !== null && operationReplayBusinessDuplicates.has(error));
}

// 재실행 원장은 PK 충돌만 새 CUID로 재시도합니다. 업무 UNIQUE 충돌은 상위 transaction이
// rollback 후 replay 행을 다시 읽게 해야 하므로 여기서 절대로 삼키지 않습니다.
async function reserveOperationReplayId(transaction: DatabaseTransaction, generate: ObjectIdentityCandidateGenerator, insert: (candidate: string) => Promise<void>): Promise<string> {
  for (let attempt = 0; attempt < OBJECT_IDENTITY_MAX_ATTEMPTS; attempt += 1) {
    const candidate = generate();
    assertCuid2Length(candidate);
    try {
      await insert(candidate);
      return candidate;
    } catch (error) {
      if (!duplicate(error)) throw error;
      if (isOperationReplayUniqueDuplicate(error)) { markOperationReplayBusinessDuplicate(error); throw error; }
      if (isPrimaryDuplicate(error)) continue;
      // 드라이버가 constraint 이름을 생략한 경우에는 후보 PK 존재 여부로만 PK 충돌을 판별합니다.
      const existing = (await transaction.query<Array<{ furniture_operation_id: string }>>(
        "SELECT furniture_operation_id FROM object_furniture_operation_replays WHERE furniture_operation_id=? FOR UPDATE",
        [candidate]
      ))[0];
      if (existing === undefined) { markOperationReplayBusinessDuplicate(error); throw error; }
    }
  }
  throw new Error("CANONICAL_FURNITURE_ID_COLLISION_RETRY_EXHAUSTED");
}

function fingerprint(operationKind: string, values: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([operationKind, ...values])).digest("hex");
}

function requireReplayMatch(row: ReplayRow, operationKind: string, payloadFingerprint: string): void {
  if (row.operation_kind !== operationKind || row.payload_fingerprint !== payloadFingerprint) throw new Error("CANONICAL_FURNITURE_IDEMPOTENCY_CONFLICT");
}

function requireGrantReplayMatch(row: ReplayRow, operationKind: string, payloadFingerprint: string): string {
  requireReplayMatch(row, operationKind, payloadFingerprint);
  if (row.result_status !== "granted" || typeof row.owned_furniture_id !== "string" || !/^[a-z][a-z0-9]{7}$/.test(row.owned_furniture_id)) throw new Error("CANONICAL_FURNITURE_REPLAY_CORRUPTED");
  return row.owned_furniture_id;
}

async function waitBeforeGrantReplayRead(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, GRANT_REPLAY_READ_DELAY_MS * (attempt + 1)));
}

const ALLOWED_OWNERSHIP_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  bag: ["listed", "removed"],
  placed: ["bag", "removed"],
  listed: ["bag", "sold"]
};

function assertAllowedOwnershipTransition(input: TransitionCanonicalFurnitureInput): void {
  if (!ALLOWED_OWNERSHIP_TRANSITIONS[input.fromStatus]?.includes(input.toStatus)) throw new Error("CANONICAL_FURNITURE_TRANSITION_INVALID");
}

// WBS742 importer와 홈 read 소비자가 함께 사용할 canonical 가구 보유 저장소입니다.
export class MariaCanonicalFurnitureHomeRepository {
  constructor(
    private readonly database: DatabaseClient,
    // WBS731 provider의 CUID2 생성기를 주입해 모든 canonical PK 정책을 하나로 유지합니다.
    private readonly generate: ObjectIdentityCandidateGenerator,
    // WBS731 provider의 KST 감사값 생성기를 주입해 시간 형식을 통일합니다.
    private readonly createAudit: CanonicalFurnitureAuditFactory,
    private readonly now: () => Date = () => new Date()
  ) {}

  async grantOwnedFurniture(input: GrantCanonicalFurnitureInput): Promise<{ furniture: CanonicalOwnedFurniture; replayed: boolean }> {
    assertGrantInput(input);
    const operationKind = "grant_owned_furniture";
    const payloadFingerprint = fingerprint(operationKind, [input.playerId, input.furnitureId, String(input.enhancementLevel ?? 0n)]);
    try {
      return await withMariaTransactionRetry(this.database, {
        maxAttempts: GRANT_TRANSACTION_MAX_ATTEMPTS,
        allowRetry: (kind) => kind === "TRANSACTION_DEADLOCK" || kind === "TRANSACTION_LOCK_WAIT_TIMEOUT",
        exhaustedErrorCode: GRANT_TRANSACTION_RETRY_EXHAUSTED,
      }, async (transaction) => {
          const replay = (await transaction.query<ReplayRow[]>(
            "SELECT owned_furniture_id,result_status,operation_kind,payload_fingerprint FROM object_furniture_operation_replays WHERE player_id=? AND idempotency_scope=? AND idempotency_key=? FOR UPDATE",
            [input.playerId, input.idempotencyScope, input.idempotencyKey]
          ))[0];
          if (replay !== undefined) {
            const ownedFurnitureId = requireGrantReplayMatch(replay, operationKind, payloadFingerprint);
            return { furniture: await this.findGrantOwned(transaction, ownedFurnitureId, input, true), replayed: true };
          }
          const player = (await transaction.query<Array<{ player_id: string }>>("SELECT player_id FROM canonical_players WHERE player_id=? FOR UPDATE", [input.playerId]))[0];
          if (player === undefined) throw new Error("CANONICAL_FURNITURE_PLAYER_NOT_FOUND");
          const definition = (await transaction.query<DefinitionRow[]>(
            "SELECT furniture_id,display_name,purchase_price,base_charm,charm_per_enhancement,active FROM object_furniture_definitions WHERE furniture_id=? FOR UPDATE",
            [input.furnitureId]
          ))[0];
          if (definition === undefined || !Boolean(definition.active)) throw new Error("CANONICAL_FURNITURE_DEFINITION_NOT_FOUND");
          const audit = this.createAudit(input.actor, this.now());
          const enhancementLevel = input.enhancementLevel ?? 0n;
          const ownedFurnitureId = await insertWithCuid8CollisionRetry(async (candidate) => {
            await transaction.execute(
              "INSERT INTO object_owned_furniture_instances(owned_furniture_id,player_id,furniture_id,enhancement_level,ownership_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,'bag',?,?,?,?)",
              [candidate, input.playerId, input.furnitureId, enhancementLevel, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
            );
          }, { generate: this.generate, exhaustedErrorCode: "CANONICAL_FURNITURE_OWNED_ID_COLLISION_RETRY_EXHAUSTED" });
          await insertWithCuid8CollisionRetry(async (candidate) => {
            await transaction.execute(
              "INSERT INTO object_furniture_operation_replays(furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?, ?,?,'granted',?,?,?,?)",
              [candidate, input.playerId, input.idempotencyScope, input.idempotencyKey, operationKind, payloadFingerprint, ownedFurnitureId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
            );
          }, { generate: this.generate, exhaustedErrorCode: "CANONICAL_FURNITURE_OPERATION_ID_COLLISION_RETRY_EXHAUSTED" });
          return { furniture: {
            ownedFurnitureId, playerId: input.playerId, furnitureId: definition.furniture_id, enhancementLevel,
            finalCharm: calculateCanonicalFurnitureCharm(BigInt(definition.base_charm), BigInt(definition.charm_per_enhancement), enhancementLevel), ownershipStatus: "bag"
          }, replayed: false };
      });
    } catch (error) {
      if (isMariaBusinessUniqueConflict(error, "uq_object_furniture_operation_replay") || isMariaTransactionRetryExhaustion(error, GRANT_TRANSACTION_RETRY_EXHAUSTED)) {
        const concurrent = await this.findConcurrentGrantReplay(input, operationKind, payloadFingerprint);
        if (concurrent !== undefined) return concurrent;
      }
      throw error;
    }
  }

  // ownership_status가 lifecycle 권위이고 placement는 placed 상태의 상세 관계입니다. 둘은 한 transaction에서 같이 기록합니다.
  async placeOwnedFurniture(input: PlaceCanonicalFurnitureInput): Promise<{ ownedFurnitureId: string; replayed: boolean }> {
    assertPlacementInput(input);
    const operationKind = "place_owned_furniture";
    const payloadFingerprint = fingerprint(operationKind, [input.playerId, input.ownedFurnitureId, String(input.placementOrder)]);
    for (let transactionAttempt = 0; transactionAttempt < OBJECT_IDENTITY_MAX_ATTEMPTS; transactionAttempt += 1) {
      try {
        return await this.database.withTransaction(async (transaction) => {
          const replay = (await transaction.query<ReplayRow[]>(
            "SELECT owned_furniture_id,result_status,operation_kind,payload_fingerprint FROM object_furniture_operation_replays WHERE player_id=? AND idempotency_scope=? AND idempotency_key=? FOR UPDATE",
            [input.playerId, input.idempotencyScope, input.idempotencyKey]
          ))[0];
          if (replay !== undefined) { requireReplayMatch(replay, operationKind, payloadFingerprint); return { ownedFurnitureId: replay.owned_furniture_id, replayed: true }; }
          const ownedFurniture = (await transaction.query<Array<{ owned_furniture_id: string; ownership_status: string }>>(
            "SELECT owned_furniture_id,ownership_status FROM object_owned_furniture_instances WHERE owned_furniture_id=? AND player_id=? FOR UPDATE",
            [input.ownedFurnitureId, input.playerId]
          ))[0];
          if (ownedFurniture === undefined) throw new Error("CANONICAL_FURNITURE_OWNERSHIP_NOT_FOUND");
          if (ownedFurniture.ownership_status !== "bag") throw new Error("CANONICAL_FURNITURE_STATE_INVALID");
          const alreadyPlaced = (await transaction.query<Array<{ home_furniture_placement_id: string }>>(
            "SELECT home_furniture_placement_id FROM object_home_furniture_placements WHERE owned_furniture_id=? FOR UPDATE",
            [input.ownedFurnitureId]
          ))[0];
          if (alreadyPlaced !== undefined) throw new Error("CANONICAL_FURNITURE_ALREADY_PLACED");
          const audit = this.createAudit(input.actor, this.now());
          let operationId = "";
          await reserveOperationReplayId(transaction, this.generate, async (candidate) => {
            await transaction.execute(
              "INSERT INTO object_furniture_operation_replays(furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,'placed',?,?,?,?)",
              [candidate, input.playerId, input.idempotencyScope, input.idempotencyKey, operationKind, payloadFingerprint, input.ownedFurnitureId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
            ); operationId = candidate;
          });
          await reserveId(transaction, this.generate, async (candidate) => {
            await transaction.execute(
              "INSERT INTO object_home_furniture_placements(home_furniture_placement_id,owned_furniture_id,placement_order,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?)",
              [candidate, input.ownedFurnitureId, input.placementOrder, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
            );
          });
          await reserveId(transaction, this.generate, async (candidate) => {
            await transaction.execute(
              "INSERT INTO object_furniture_ownership_history(furniture_ownership_history_id,owned_furniture_id,furniture_operation_id,status_before,status_after,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'bag','placed',?,?,?,?)",
              [candidate, input.ownedFurnitureId, operationId, audit.INSERT_USER, audit.INSERT_TIME, audit.UPDATE_USER, audit.UPDATE_TIME]
            );
          });
          await transaction.execute("UPDATE object_owned_furniture_instances SET ownership_status='placed',UPDATE_USER=?,UPDATE_TIME=? WHERE owned_furniture_id=? AND player_id=? AND ownership_status='bag'", [audit.UPDATE_USER, audit.UPDATE_TIME, input.ownedFurnitureId, input.playerId]);
          return { ownedFurnitureId: input.ownedFurnitureId, replayed: false };
        });
      } catch (error) {
        if (!isOperationReplayBusinessDuplicate(error)) throw error;
      }
    }
    throw new Error("CANONICAL_FURNITURE_IDEMPOTENCY_RETRY_EXHAUSTED");
  }

  // 해제·등록·취소·판매·삭제는 소유 상태와 placement/market 관계를 한 transaction에서 같이 바꿉니다.
  async transitionOwnedFurniture(input: TransitionCanonicalFurnitureInput): Promise<{ ownedFurnitureId: string; replayed: boolean }> {
    assertPlacementInput({ ...input, placementOrder: 0n });
    assertAllowedOwnershipTransition(input);
    if (input.toStatus === "listed" && (input.listingPrice === undefined || input.listingPrice < 0n)) throw new Error("CANONICAL_FURNITURE_LISTING_PRICE_INVALID");
    const kind = `transition_${input.fromStatus}_to_${input.toStatus}`;
    const digest = fingerprint(kind, [input.playerId, input.ownedFurnitureId, String(input.listingPrice ?? "")]);
    for (let attempt = 0; attempt < OBJECT_IDENTITY_MAX_ATTEMPTS; attempt += 1) try {
      return await this.database.withTransaction(async (transaction) => {
      const replay = (await transaction.query<ReplayRow[]>("SELECT owned_furniture_id,result_status,operation_kind,payload_fingerprint FROM object_furniture_operation_replays WHERE player_id=? AND idempotency_scope=? AND idempotency_key=? FOR UPDATE", [input.playerId, input.idempotencyScope, input.idempotencyKey]))[0];
      if (replay !== undefined) { requireReplayMatch(replay, kind, digest); return { ownedFurnitureId: replay.owned_furniture_id, replayed: true }; }
      const audit = this.createAudit(input.actor, this.now());
      const changed = await transaction.execute("UPDATE object_owned_furniture_instances SET ownership_status=?,UPDATE_USER=?,UPDATE_TIME=? WHERE owned_furniture_id=? AND player_id=? AND ownership_status=?", [input.toStatus, audit.UPDATE_USER, audit.UPDATE_TIME, input.ownedFurnitureId, input.playerId, input.fromStatus]);
      if (changed.affectedRows !== 1n) throw new Error("CANONICAL_FURNITURE_STATE_INVALID");
      if (input.fromStatus === "placed") await transaction.execute("DELETE FROM object_home_furniture_placements WHERE owned_furniture_id=?", [input.ownedFurnitureId]);
      if (input.toStatus === "listed") {
        const furnitureMarketListingId = await reserveId(transaction, this.generate, async (candidate) => {
          await transaction.execute("INSERT INTO object_furniture_market_listings(furniture_market_listing_id,owned_furniture_id,listing_price,listing_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'active',?,?,?,?)", [candidate,input.ownedFurnitureId,input.listingPrice!,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
        });
        await transaction.execute("INSERT INTO object_furniture_active_market_listings(furniture_market_listing_id,owned_furniture_id,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?)", [furnitureMarketListingId,input.ownedFurnitureId,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
      } else if (input.fromStatus === "listed") {
        const listingStatus = input.toStatus === "sold" ? "sold" : "cancelled";
        const listing = await transaction.execute("UPDATE object_furniture_market_listings listing JOIN object_furniture_active_market_listings active ON active.furniture_market_listing_id=listing.furniture_market_listing_id SET listing.listing_status=?,listing.UPDATE_USER=?,listing.UPDATE_TIME=? WHERE active.owned_furniture_id=? AND listing.listing_status='active'", [listingStatus,audit.UPDATE_USER,audit.UPDATE_TIME,input.ownedFurnitureId]);
        if (listing.affectedRows !== 1n) throw new Error("CANONICAL_FURNITURE_MARKET_STATE_INVALID");
        const activeListing = await transaction.execute("DELETE FROM object_furniture_active_market_listings WHERE owned_furniture_id=?", [input.ownedFurnitureId]);
        if (activeListing.affectedRows !== 1n) throw new Error("CANONICAL_FURNITURE_MARKET_STATE_INVALID");
      }
      let operationId = "";
      await reserveOperationReplayId(transaction, this.generate, async (candidate) => { await transaction.execute("INSERT INTO object_furniture_operation_replays(furniture_operation_id,player_id,idempotency_scope,idempotency_key,operation_kind,payload_fingerprint,owned_furniture_id,result_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,'transitioned',?,?,?,?)", [candidate,input.playerId,input.idempotencyScope,input.idempotencyKey,kind,digest,input.ownedFurnitureId,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]); operationId=candidate; });
      await reserveId(transaction, this.generate, async (candidate) => { await transaction.execute("INSERT INTO object_furniture_ownership_history(furniture_ownership_history_id,owned_furniture_id,furniture_operation_id,status_before,status_after,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?)", [candidate,input.ownedFurnitureId,operationId,input.fromStatus,input.toStatus,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]); });
      return { ownedFurnitureId: input.ownedFurnitureId, replayed: false };
      });
    } catch (error) { if (!isOperationReplayBusinessDuplicate(error)) throw error; }
    throw new Error("CANONICAL_FURNITURE_IDEMPOTENCY_RETRY_EXHAUSTED");
  }

  // 홈 화면은 definition과 instance를 조인해 현재 정의 기준의 매력을 읽습니다.
  async listPlacedFurniture(playerId: string): Promise<CanonicalOwnedFurniture[]> {
    assertCuid2Length(playerId);
    const rows = await this.database.query<OwnedRow[]>(
      "SELECT owned.owned_furniture_id,owned.player_id,owned.furniture_id,owned.enhancement_level,definition.base_charm,definition.charm_per_enhancement FROM object_home_furniture_placements placement JOIN object_owned_furniture_instances owned ON owned.owned_furniture_id=placement.owned_furniture_id JOIN object_furniture_definitions definition ON definition.furniture_id=owned.furniture_id WHERE owned.player_id=? AND owned.ownership_status='placed' ORDER BY placement.placement_order,placement.home_furniture_placement_id",
      [playerId]
    );
    return rows.map((row) => owned(row, "placed"));
  }

  private async findOwnedForUpdate(transaction: DatabaseTransaction, ownedFurnitureId: string): Promise<CanonicalOwnedFurniture> {
    const row = (await transaction.query<OwnedRow[]>(
      "SELECT owned.owned_furniture_id,owned.player_id,owned.furniture_id,owned.enhancement_level,definition.base_charm,definition.charm_per_enhancement FROM object_owned_furniture_instances owned JOIN object_furniture_definitions definition ON definition.furniture_id=owned.furniture_id WHERE owned.owned_furniture_id=? FOR UPDATE",
      [ownedFurnitureId]
    ))[0];
    if (row === undefined) throw new Error("CANONICAL_FURNITURE_REPLAY_CORRUPTED");
    return owned(row);
  }

  private async findGrantOwned(queryable: Pick<DatabaseClient, "query">, ownedFurnitureId: string, input: GrantCanonicalFurnitureInput, lock: boolean): Promise<CanonicalOwnedFurniture> {
    const row = (await queryable.query<Array<{ owned_furniture_id: string; base_charm: bigint; charm_per_enhancement: bigint }>>(
      `SELECT owned.owned_furniture_id,definition.base_charm,definition.charm_per_enhancement FROM object_owned_furniture_instances owned JOIN object_furniture_definitions definition ON definition.furniture_id=owned.furniture_id WHERE owned.owned_furniture_id=? AND owned.player_id=? AND owned.furniture_id=?${lock ? " FOR UPDATE" : ""}`,
      [ownedFurnitureId, input.playerId, input.furnitureId]
    ))[0];
    if (row === undefined) throw new Error("CANONICAL_FURNITURE_REPLAY_CORRUPTED");
    const enhancementLevel = input.enhancementLevel ?? 0n;
    return {
      ownedFurnitureId: row.owned_furniture_id,
      playerId: input.playerId,
      furnitureId: input.furnitureId,
      enhancementLevel,
      finalCharm: calculateCanonicalFurnitureCharm(BigInt(row.base_charm), BigInt(row.charm_per_enhancement), enhancementLevel),
      ownershipStatus: "bag",
    };
  }

  private async findConcurrentGrantReplay(input: GrantCanonicalFurnitureInput, operationKind: string, payloadFingerprint: string): Promise<{ furniture: CanonicalOwnedFurniture; replayed: boolean } | undefined> {
    for (let attempt = 0; attempt < GRANT_REPLAY_READ_ATTEMPTS; attempt += 1) {
      await waitBeforeGrantReplayRead(attempt);
      const replay = (await this.database.query<ReplayRow[]>(
        "SELECT owned_furniture_id,result_status,operation_kind,payload_fingerprint FROM object_furniture_operation_replays WHERE player_id=? AND idempotency_scope=? AND idempotency_key=?",
        [input.playerId, input.idempotencyScope, input.idempotencyKey]
      ))[0];
      if (replay !== undefined) {
        const ownedFurnitureId = requireGrantReplayMatch(replay, operationKind, payloadFingerprint);
        return { furniture: await this.findGrantOwned(this.database, ownedFurnitureId, input, false), replayed: true };
      }
    }
    return undefined;
  }
}
