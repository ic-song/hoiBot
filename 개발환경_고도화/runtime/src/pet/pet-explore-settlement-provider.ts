import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createCurrentDomainItemProvider } from "../package/current-domain-package-runtime.js";
import type { ItemMutationContext, ItemProvider } from "../package/item-provider.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  PetExploreParticipationProvider,
  type PetExploreParticipationInput,
  type PetExploreParticipationResult,
} from "./pet-explore-participation-provider.js";

export type PetExploreSettlementSource = "manual" | "scheduler";
export type PetExploreTicketPolicy = "none" | "consume_or_fail" | "consume_or_regular_fallback";
export type PetExploreSettlementDestination = PetExploreParticipationInput["destinationCode"];
export interface PetExploreSettlementReward { itemCode: string; quantity: string }
export interface PetExploreSettlementPlan {
  participationId: string;
  expectedVersion: string;
  premiumActive: boolean;
  successThresholdBasisPoints: number;
  ticketPolicy: PetExploreTicketPolicy;
  ticketItemCode: string | null;
  fallbackDestinations: readonly ["pet_enhancement_mine", "intimacy_mine", "luck_mine"] | null;
  successRewards: readonly PetExploreSettlementReward[];
  failureRewards: readonly PetExploreSettlementReward[];
}
export interface PetExploreSettlementInput {
  roundKey: string;
  expectedRoundVersion: string;
  source: PetExploreSettlementSource;
  actorId: string;
  idempotencyKey: string;
  policyHash: string;
  reason: string;
  destinationId: string;
  plans: readonly PetExploreSettlementPlan[];
  nextAutoReservations: readonly PetExploreParticipationInput[];
}
export interface PetExploreSettlementParticipantResult {
  participationId: string;
  playerId: string;
  requestedDestinationCode: PetExploreSettlementDestination;
  effectiveDestinationCode: PetExploreSettlementDestination;
  resultCode: "success" | "failure" | "ineligible";
  ticketItemCode: string | null;
  ticketConsumed: boolean;
  fallbackApplied: boolean;
  successThresholdBasisPoints: number;
  successRollBasisPoints: number | null;
  previousVersion: string;
  version: string;
  rewards: readonly PetExploreSettlementReward[];
}
export interface PetExploreSettlementResult {
  status: "settled" | "noop";
  roundId: string;
  roundKey: string;
  previousRoundVersion: string;
  roundVersion: string;
  participantCount: string;
  successCount: string;
  failureCount: string;
  ineligibleCount: string;
  participants: readonly PetExploreSettlementParticipantResult[];
  nextAutoResults: readonly PetExploreParticipationResult[];
  operationId: string;
  auditId: string;
  outboxId: string;
  replayed: boolean;
}

interface StoredEnvelope { fingerprint: string; result: PetExploreSettlementResult }
interface RoundRow { id: bigint; state_code: string; version: bigint }
interface ParticipationRow { id: bigint; player_id: bigint; destination_code: PetExploreSettlementDestination; version: bigint }
interface ItemTransactionHandle { id: string; databaseTransaction: DatabaseTransaction; operationId: string; sequenceNo: number }
const REGULAR_DUNGEONS = new Set<PetExploreSettlementDestination>(["jeondor_dungeon", "chicken_farm_dungeon", "land_document_dungeon", "shop_open_dungeon"]);

export function petExploreSettlementSample(seed: string, participationId: string, stage: "fallback" | "success"): number {
  return Number.parseInt(createHash("sha256").update(`${seed}|${participationId}|${stage}`).digest("hex").slice(0, 8), 16) % 10000;
}

export function createPetExploreSettlementFingerprint(input: PetExploreSettlementInput): string {
  const plans = input.plans.slice().sort((left, right) => BigInt(left.participationId) < BigInt(right.participationId) ? -1 : 1);
  const next = input.nextAutoReservations.slice().sort((left, right) => BigInt(left.playerId) < BigInt(right.playerId) ? -1 : 1);
  return createHash("sha256").update(JSON.stringify({ ...input, reason: input.reason.trim(), plans, nextAutoReservations: next })).digest("hex");
}

function decimal(value: string, field: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_DECIMAL_INVALID", `${field}은 양의 정수 문자열이어야 합니다.`, 422);
  return value;
}
function stable(value: string, field: string, max: number): string {
  const result = value.trim();
  if (result.length === 0 || result.length > max || !/^[A-Za-z0-9._:-]+$/.test(result)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_KEY_INVALID", `${field} stable key가 올바르지 않습니다.`, 422);
  return result;
}
function reason(value: string): string {
  const result = value.trim();
  if (result.length < 5 || result.length > 500 || /[\u0000-\u001f]/.test(result)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_REASON_INVALID", "정산 사유는 5~500자여야 합니다.", 422);
  return result;
}
function key(value: string): string {
  const result = value.trim();
  if (!result) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_IDEMPOTENCY_INVALID", "Idempotency key가 필요합니다.", 422);
  return result.length <= 191 ? result : `sha256:${createHash("sha256").update(result).digest("hex")}`;
}
function envelope(value: string | StoredEnvelope): StoredEnvelope { return typeof value === "string" ? JSON.parse(value) as StoredEnvelope : value; }
function positiveQuantity(value: string): bigint { const normalized = decimal(value, "reward quantity"); return BigInt(normalized); }
function insufficient(error: unknown): boolean { return error instanceof Error && error.message === "ITEM_BALANCE_INSUFFICIENT"; }

function transactionClient(transaction: DatabaseTransaction): DatabaseClient {
  return {
    ping: async () => undefined,
    query: (sql, values) => transaction.query(sql, values),
    execute: (sql, values) => transaction.execute(sql, values),
    withTransaction: async <T>(work: (nested: DatabaseTransaction) => Promise<T>) => work(transaction),
    verifyRollback: async () => true,
    close: async () => undefined,
  };
}

// round 정산과 보상, record, scheduler, 다음 auto 참가를 하나의 transaction으로 완료합니다.
export class PetExploreSettlementProvider {
  private readonly items: ItemProvider;
  public constructor(private readonly database: DatabaseClient, items?: ItemProvider) {
    this.items = items ?? createCurrentDomainItemProvider(database);
  }

  public async settle(input: PetExploreSettlementInput): Promise<PetExploreSettlementResult> {
    const roundKey = stable(input.roundKey, "roundKey", 128);
    const expectedRoundVersion = decimal(input.expectedRoundVersion, "expectedRoundVersion");
    const actorId = decimal(input.actorId, "actorId");
    const idempotencyKey = key(input.idempotencyKey);
    const auditReason = reason(input.reason);
    if (!/^[a-f0-9]{64}$/.test(input.policyHash)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_POLICY_HASH_INVALID", "policyHash는 SHA256이어야 합니다.", 422);
    this.validatePlans(input.plans);
    if (input.nextAutoReservations.some((reservation) => reservation.mode !== "auto")) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_NEXT_AUTO_INVALID", "next reservation은 auto mode만 허용합니다.", 422);
    const normalized = { ...input, roundKey, expectedRoundVersion, actorId, idempotencyKey, reason: auditReason };
    const fingerprint = createPetExploreSettlementFingerprint(normalized);
    const operationScope = "pet_explore.settlement";
    const operationKey = key(roundKey);

    return this.database.withTransaction(async (transaction) => {
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,? ,?,?, 'processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [randomUUID(), operationScope, operationKey, input.source === "manual" ? "admin_operator" : "system", actorId, input.source === "manual" ? "admin_api" : "scheduler"],
      );
      const claimed = (await transaction.query<Array<{ result_json: string | StoredEnvelope | null }>>("SELECT result_json FROM operations WHERE id=? FOR UPDATE", [operation.insertId]))[0];
      if (claimed === undefined) throw new Error("Pet explore settlement operation claim failed.");
      if (claimed.result_json !== null) {
        const stored = envelope(claimed.result_json);
        if (stored.fingerprint !== fingerprint) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_IDEMPOTENCY_PAYLOAD_MISMATCH", "이미 정산된 round에 다른 payload를 사용할 수 없습니다.", 409);
        return { ...stored.result, replayed: true };
      }

      await transaction.query("SELECT config_id FROM pet_explore_runtime_config WHERE config_id=1 FOR UPDATE");
      const round = (await transaction.query<RoundRow[]>("SELECT id,state_code,version FROM pet_explore_rounds WHERE round_key=? FOR UPDATE", [roundKey]))[0];
      if (round === undefined) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_ROUND_NOT_FOUND", "정산 round를 찾을 수 없습니다.", 404);
      if (round.state_code !== "open") throw new ApplicationError("PET_EXPLORE_SETTLEMENT_ROUND_CLOSED", "이미 종료된 round입니다.", 409);
      if (round.version.toString() !== expectedRoundVersion) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_ROUND_VERSION_CONFLICT", "round가 먼저 변경되었습니다.", 409, { expectedVersion: expectedRoundVersion, actualVersion: round.version.toString() });
      const participations = await transaction.query<ParticipationRow[]>(
        "SELECT id,player_id,destination_code,version FROM pet_explore_participations WHERE round_id=? AND state_code='active' ORDER BY id FOR UPDATE",
        [round.id],
      );
      const plans = input.plans.slice().sort((left, right) => BigInt(left.participationId) < BigInt(right.participationId) ? -1 : 1);
      if (participations.length !== plans.length || participations.some((row, index) => row.id.toString() !== plans[index]?.participationId)) {
        throw new ApplicationError("PET_EXPLORE_SETTLEMENT_PARTICIPATION_SET_CONFLICT", "active participation과 settlement plan이 일치하지 않습니다.", 409);
      }
      const premiumGap = (await transaction.query<Array<{ status_code: string }>>("SELECT status_code FROM pet_explore_settlement_policy_gaps WHERE gap_code='premium_explore_bonus' FOR UPDATE"))[0];
      if (plans.some((plan) => plan.premiumActive) && premiumGap?.status_code !== "RESOLVED") {
        throw new ApplicationError("PET_EXPLORE_PREMIUM_POLICY_CONFLICT", "premium 탐험 보너스 canonical policy가 확정되지 않았습니다.", 409);
      }

      const itemHandle: ItemTransactionHandle = { id: randomUUID(), databaseTransaction: transaction, operationId: operation.insertId.toString(), sequenceNo: 0 };
      const seed = `${input.policyHash}|${roundKey}|${idempotencyKey}`;
      const seedHash = createHash("sha256").update(seed).digest("hex");
      const results: PetExploreSettlementParticipantResult[] = [];
      let rngSequence = 0;
      let successCount = 0;
      let failureCount = 0;
      let ineligibleCount = 0;

      for (let index = 0; index < participations.length; index++) {
        const participation = participations[index]!;
        const plan = plans[index]!;
        if (participation.version.toString() !== plan.expectedVersion) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_PARTICIPATION_VERSION_CONFLICT", "participation이 먼저 변경되었습니다.", 409);
        const context = (operationCode: "ADD" | "REMOVE", requestSuffix: string): ItemMutationContext => ({
          ownerType: "USER", ownerId: participation.player_id.toString(), actorUserId: participation.player_id.toString(),
          transactionId: `pet-explore-settlement:${operation.insertId.toString()}`, transactionHandle: itemHandle,
          requestKey: `${roundKey}:${participation.id.toString()}:${requestSuffix}`, operation: operationCode,
        });
        let effectiveDestination = participation.destination_code;
        let ticketConsumed = false;
        let fallbackApplied = false;
        let eligible = true;
        if (plan.ticketPolicy !== "none") {
          const ticketCode = plan.ticketItemCode!;
          try {
            await this.items.checkRemove(ticketCode, 1n, context("REMOVE", "ticket-check"));
            await this.items.remove(ticketCode, 1n, context("REMOVE", "ticket-remove"));
            ticketConsumed = true;
          } catch (error) {
            if (!insufficient(error)) throw error;
            if (plan.ticketPolicy === "consume_or_regular_fallback") {
              const fallbackSample = petExploreSettlementSample(seed, plan.participationId, "fallback");
              rngSequence += 1;
              await transaction.execute("INSERT INTO pet_explore_settlement_rng_evidence(operation_id,rng_sequence,participation_id,stage_code,sample_basis_points,seed_hash) VALUES (?,?,?,'fallback',?,?)", [operation.insertId, rngSequence, participation.id, fallbackSample, seedHash]);
              effectiveDestination = plan.fallbackDestinations![fallbackSample % 3]!;
              fallbackApplied = true;
            } else eligible = false;
          }
        }
        let resultCode: PetExploreSettlementParticipantResult["resultCode"] = "ineligible";
        let successRoll: number | null = null;
        let rewards: readonly PetExploreSettlementReward[] = [];
        if (eligible) {
          successRoll = petExploreSettlementSample(seed, plan.participationId, "success");
          rngSequence += 1;
          await transaction.execute("INSERT INTO pet_explore_settlement_rng_evidence(operation_id,rng_sequence,participation_id,stage_code,sample_basis_points,seed_hash) VALUES (?,?,?,'success',?,?)", [operation.insertId, rngSequence, participation.id, successRoll, seedHash]);
          resultCode = successRoll < plan.successThresholdBasisPoints ? "success" : "failure";
          rewards = resultCode === "success" ? plan.successRewards : plan.failureRewards;
          for (let rewardIndex = 0; rewardIndex < rewards.length; rewardIndex++) {
            const reward = rewards[rewardIndex]!;
            const quantity = positiveQuantity(reward.quantity);
            await this.items.checkAdd(reward.itemCode, quantity, context("ADD", `reward-${rewardIndex + 1}-check`));
            await this.items.add(reward.itemCode, quantity, context("ADD", `reward-${rewardIndex + 1}-add`));
            await transaction.execute("INSERT INTO pet_explore_settlement_reward_results(operation_id,result_sequence,reward_sequence,player_id,item_code,quantity) VALUES (?,?,?,?,?,?)", [operation.insertId, index + 1, rewardIndex + 1, participation.player_id, reward.itemCode, quantity]);
          }
          await transaction.execute(
            `INSERT INTO pet_explore_player_records(player_id,attempts,wins,losses,version,updated_operation_id)
             VALUES (?,1,?,?,1,?) ON DUPLICATE KEY UPDATE attempts=attempts+1,wins=wins+VALUES(wins),losses=losses+VALUES(losses),version=version+1,updated_operation_id=VALUES(updated_operation_id)`,
            [participation.player_id, resultCode === "success" ? 1 : 0, resultCode === "failure" ? 1 : 0, operation.insertId],
          );
          if (resultCode === "success") successCount += 1; else failureCount += 1;
        } else ineligibleCount += 1;
        const participationWrite = await transaction.execute("UPDATE pet_explore_participations SET state_code='settled',destination_code=?,version=version+1,updated_operation_id=? WHERE id=? AND version=? AND state_code='active'", [effectiveDestination, operation.insertId, participation.id, participation.version]);
        if (participationWrite.affectedRows !== 1n) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_PARTICIPATION_VERSION_CONFLICT", "participation이 먼저 변경되었습니다.", 409);
        await transaction.execute(
          `INSERT INTO pet_explore_settlement_results(operation_id,result_sequence,participation_id,player_id,requested_destination_code,effective_destination_code,result_code,ticket_item_code,ticket_consumed,fallback_applied,success_threshold_basis_points,success_roll_basis_points,previous_version,resulting_version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [operation.insertId, index + 1, participation.id, participation.player_id, participation.destination_code, effectiveDestination, resultCode, plan.ticketItemCode, ticketConsumed, fallbackApplied, plan.successThresholdBasisPoints, successRoll, participation.version, participation.version + 1n],
        );
        results.push({ participationId: participation.id.toString(), playerId: participation.player_id.toString(), requestedDestinationCode: participation.destination_code, effectiveDestinationCode: effectiveDestination, resultCode, ticketItemCode: plan.ticketItemCode, ticketConsumed, fallbackApplied, successThresholdBasisPoints: plan.successThresholdBasisPoints, successRollBasisPoints: successRoll, previousVersion: participation.version.toString(), version: (participation.version + 1n).toString(), rewards });
      }

      const roundWrite = await transaction.execute("UPDATE pet_explore_rounds SET state_code='closed',version=version+1,updated_operation_id=? WHERE id=? AND version=? AND state_code='open'", [operation.insertId, round.id, round.version]);
      if (roundWrite.affectedRows !== 1n) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_ROUND_VERSION_CONFLICT", "round가 먼저 변경되었습니다.", 409);
      if (input.source === "scheduler") await transaction.execute("UPDATE pet_explore_scheduler_state SET immediate_run_pending=FALSE,generation=generation+1,next_run_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL interval_minutes MINUTE),started_operation_id=? WHERE schedule_code='pet_explore'", [operation.insertId]);

      const nextProvider = new PetExploreParticipationProvider(transactionClient(transaction));
      const nextAutoResults: PetExploreParticipationResult[] = [];
      for (const reservation of input.nextAutoReservations) nextAutoResults.push(await nextProvider.reserve(reservation));
      const status: PetExploreSettlementResult["status"] = results.length === 0 ? "noop" : "settled";
      await transaction.execute(
        `INSERT INTO pet_explore_settlements(operation_id,round_id,source_code,status_code,policy_hash,request_fingerprint,previous_round_version,resulting_round_version,participant_count,success_count,failure_count,ineligible_count,next_auto_result_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [operation.insertId, round.id, input.source, status, input.policyHash, fingerprint, round.version, round.version + 1n, results.length, successCount, failureCount, ineligibleCount, JSON.stringify(nextAutoResults)],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,?,?,?,?,'pet_explore.settlement',?,?,?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.source === "manual" ? "admin_operator" : "system", actorId, "pet_explore_round", round.id, status, auditReason, JSON.stringify({ roundKey, participantCount: results.length, successCount, failureCount, ineligibleCount, nextAutoCount: nextAutoResults.length, policyHash: input.policyHash })],
      );
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'internal',?,'pet_explore.settlement',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.destinationId, JSON.stringify({ roundKey, status, participantCount: results.length, successCount, failureCount, ineligibleCount, nextAutoCount: nextAutoResults.length })]);
      const result: PetExploreSettlementResult = { status, roundId: round.id.toString(), roundKey, previousRoundVersion: round.version.toString(), roundVersion: (round.version + 1n).toString(), participantCount: String(results.length), successCount: String(successCount), failureCount: String(failureCount), ineligibleCount: String(ineligibleCount), participants: results, nextAutoResults, operationId: operation.insertId.toString(), auditId: audit.insertId.toString(), outboxId: outbox.insertId.toString(), replayed: false };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify({ fingerprint, result } satisfies StoredEnvelope), operation.insertId]);
      return result;
    });
  }

  private validatePlans(plans: readonly PetExploreSettlementPlan[]): void {
    const ids = new Set<string>();
    for (const plan of plans) {
      decimal(plan.participationId, "participationId"); decimal(plan.expectedVersion, "expectedVersion");
      if (ids.has(plan.participationId)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_PLAN_DUPLICATE", "중복 participation plan입니다.", 422);
      ids.add(plan.participationId);
      if (!Number.isInteger(plan.successThresholdBasisPoints) || plan.successThresholdBasisPoints < 0 || plan.successThresholdBasisPoints > 10000) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_THRESHOLD_INVALID", "성공 확률 basis points가 올바르지 않습니다.", 422);
      if (plan.ticketPolicy === "none" && (plan.ticketItemCode !== null || plan.fallbackDestinations !== null)) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_TICKET_POLICY_INVALID", "ticket 없는 plan의 ticket 정보가 존재합니다.", 422);
      if (plan.ticketPolicy !== "none" && !plan.ticketItemCode) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_TICKET_POLICY_INVALID", "entry ticket item code가 필요합니다.", 422);
      if (plan.ticketPolicy === "consume_or_regular_fallback" && plan.fallbackDestinations === null) throw new ApplicationError("PET_EXPLORE_SETTLEMENT_FALLBACK_INVALID", "regular fallback 3종이 필요합니다.", 422);
      for (const reward of [...plan.successRewards, ...plan.failureRewards]) { stable(reward.itemCode, "reward itemCode", 191); positiveQuantity(reward.quantity); }
    }
  }
}
