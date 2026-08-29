import { createHash, randomUUID } from "node:crypto";
import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { GuildTerritoryWarFinishService, type GuildTerritoryWarFinishResult } from "./guild-territory-war-finish-service.js";

const COMMAND_CODE = "GUILD_TERRITORY_ATTACK_EXECUTE";
const IDEMPOTENCY_SCOPE = "guild.territory.attack.execute";
const POLICY_SCOPE = "world-attack";
const WORLD_SCOPE = "world";

interface AttackPolicyRow {
  policy_version: bigint;
  status: string;
  personal_attack_limit: number;
  max_owned_territories: number;
  wrong_turn_penalty: number;
  dimension_eliminate_bps: number;
  dimension_player_penalty: number;
  dimension_attack_penalty: number;
  remember_success_bps: number;
  turn_fund: bigint;
  max_owned_fund_multiplier: number;
  defense_ticket_item_code: string;
  defense_ticket_bps: number;
  attack_ticket_item_code: string;
  attack_ticket_bps: number;
  contribution_medal_item_code: string;
  contribution_medal_bps: number | null;
  contribution_medal_quantity: bigint | null;
  evidence_label: string | null;
  rift_event_base_bps: number | null;
  instability_bps_per_point: number | null;
  normal_rift_base_bps: number | null;
  rift_bias_bps_per_point: number | null;
  rift_evidence_label: string | null;
}

interface ActorRow { player_id: bigint; guild_id: bigint; display_name: string | null }
interface WarRow { id: bigint; war_key: string; active: number; lifecycle_state: string; start_ready: number; current_turn_no: bigint; instability_adjust: string; rift_bias: string; rift_event_count: bigint; rift_event_history_json: string | Array<unknown>; version: bigint }
interface TurnRow { generation_version: bigint; ordinal: bigint; guild_id: bigint; attack_limit: number; attacks_used: number; turn_state: string; version: bigint }
interface PlayerStateRow { attacks_used: number; dimension_penalty_turns: number; eliminated: number; version: bigint }
interface GuildStateRow { eliminated: number; version: bigint }
interface OccupationRow { territory_no: bigint; territory_name: string; owner_guild_id: bigint | null; owner_player_id: bigint | null }
interface SnapshotRow { player_id: bigint; guild_id: bigint; castle_charm: bigint; critical_bps: number; critical_multiplier_bps: number; surprise_defense_bonus_bps: number; pet_snapshot_json: string | Record<string, unknown> }
interface ItemRow { id: bigint; quantity: bigint }

export interface GuildTerritoryAttackCommand { targetNo: number }
export interface GuildTerritoryAttackInput { eventId: string; externalUserId: string; channelId: string; targetNo: number }
export interface GuildTerritoryAttackResult {
  status: "attacked" | "blocked_max_owned" | "wrong_turn_penalty" | "dimension" | "remember";
  resultCode: string;
  warId: string;
  guildId: string;
  playerId: string;
  targetNo: number;
  playerAttacksUsed: number;
  guildAttacksUsed: number;
  guildAttackLimit: number;
  warVersionBefore: string;
  warVersionAfter: string;
  releasedTerritoryNo: number | null;
  winnerPlayerId: string | null;
  riftEventStatus: "rift" | "great_rift" | null;
  riftTargetGuildId: string | null;
  finishResult: GuildTerritoryWarFinishResult | null;
  data: string;
  outboxId: string;
  auditId: string;
}
export type GuildTerritoryAttackIrisResult = null | { status: "shadow" } | { status: "changed"; result: GuildTerritoryAttackResult };

// 정확한 숫자 인자 하나를 가진 영지공격 명령만 파싱합니다.
export function parseGuildTerritoryAttackCommand(message: string | undefined): GuildTerritoryAttackCommand | null {
  if (message === undefined || !/^\/영지공격\s+[1-9]$/.test(message)) return null;
  return { targetNo: Number(message.slice(message.lastIndexOf(" ") + 1)) };
}

// 공용 dispatch가 정확한 영지공격 입력만 후보로 분류합니다.
export function isGuildTerritoryAttackCommand(message: string | undefined): boolean {
  return parseGuildTerritoryAttackCommand(message) !== null;
}

// 같은 이벤트와 회차의 난수를 0~9999 범위의 재현 가능한 값으로 만듭니다.
export function deterministicGuildTerritoryDrawBps(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 10000;
}

// snapshot 매력과 치명타 draw로 동률 시 방어자가 이기는 전투를 계산합니다.
export function resolveGuildTerritorySnapshotCombat(input: { attacker: SnapshotRow; defender: SnapshotRow; attackerDrawBps: number; defenderDrawBps: number }): { attackerWins: boolean; attackerCritical: boolean; defenderCritical: boolean; attackerFinalCharm: bigint; defenderFinalCharm: bigint } {
  const attackerCritical = input.attackerDrawBps < input.attacker.critical_bps;
  const defenderCritical = input.defenderDrawBps < input.defender.critical_bps;
  const attackerFinalCharm = attackerCritical ? input.attacker.castle_charm * BigInt(input.attacker.critical_multiplier_bps) / 10000n : input.attacker.castle_charm;
  const defenderFinalCharm = defenderCritical ? input.defender.castle_charm * BigInt(input.defender.critical_multiplier_bps) / 10000n : input.defender.castle_charm;
  return { attackerWins: attackerFinalCharm > defenderFinalCharm, attackerCritical, defenderCritical, attackerFinalCharm, defenderFinalCharm };
}

// 영지공격의 인증, 잠금, 횟수, 전투와 종료 연계를 한 transaction에서 처리합니다.
export class GuildTerritoryAttackService {
  constructor(private readonly database: DatabaseClient) {}

  // SHADOW registry를 존중하며 정확 명령만 Iris 공격 처리로 전달합니다.
  async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<GuildTerritoryAttackIrisResult> {
    const command = parseGuildTerritoryAttackCommand(input.message);
    if (command === null) return null;
    const registry = (await this.database.query<Array<{ rollout_state: string; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]
    ))[0];
    if (registry === undefined || registry.enabled !== 1 || registry.rollout_state === "LEGACY_ONLY") return null;
    if (registry.rollout_state !== "ACTIVE") return { status: "shadow" };
    return { status: "changed", result: await this.attack({ eventId: input.eventId, externalUserId: input.externalUserId, channelId: input.channelId, targetNo: command.targetNo }) };
  }

  // 교착 재시도와 event replay를 포함해 공격 전체 상태를 원자 변경합니다.
  async attack(input: GuildTerritoryAttackInput): Promise<GuildTerritoryAttackResult> {
    const eventKey = normalizeEventKey(input.eventId);
    return retryDeadlock(() => this.database.withTransaction(async (transaction) => {
      const replay = await this.findReplay(transaction, eventKey);
      if (replay !== null) return replay;
      const policy = await this.loadActivePolicy(transaction);
      const actor = await this.loadActor(transaction, input.externalUserId);
      const scope = (await transaction.query<Array<{ war_id: bigint }>>(
        "SELECT war_id FROM guild_territory_start_scopes WHERE scope_code=? FOR UPDATE", [WORLD_SCOPE]
      ))[0];
      if (scope === undefined) throw new ApplicationError("GUILD_TERRITORY_ATTACK_SCOPE_MISSING", "길드 영지전 범위를 찾을 수 없습니다.", 409);
      const war = (await transaction.query<WarRow[]>(
        "SELECT id,war_key,active,lifecycle_state,start_ready,current_turn_no,CAST(instability_adjust AS CHAR) instability_adjust,CAST(rift_bias AS CHAR) rift_bias,rift_event_count,rift_event_history_json,version FROM guild_territory_wars WHERE id=? FOR UPDATE", [scope.war_id]
      ))[0];
      if (war === undefined || war.active !== 1 || war.start_ready !== 1 || war.lifecycle_state !== "ACTIVE_READY") {
        throw new ApplicationError("GUILD_TERRITORY_ATTACK_NOT_ACTIVE", "현재 공격 가능한 길드 영지전이 없습니다.", 409);
      }
      const replayAfterWarLock = await this.findReplay(transaction, eventKey);
      if (replayAfterWarLock !== null) return replayAfterWarLock;
      const currentTurn = (await transaction.query<TurnRow[]>(
        `SELECT generation_version,ordinal,guild_id,attack_limit,attacks_used,turn_state,version
         FROM guild_territory_turns WHERE war_id=? AND ordinal=? ORDER BY generation_version DESC LIMIT 1 FOR UPDATE`,
        [war.id, war.current_turn_no]
      ))[0];
      if (currentTurn === undefined || currentTurn.turn_state !== "ACTIVE") {
        throw new ApplicationError("GUILD_TERRITORY_ATTACK_TURN_MISSING", "현재 길드 공격 턴을 찾을 수 없습니다.", 409);
      }
      const actorTurn = (await transaction.query<TurnRow[]>(
        `SELECT generation_version,ordinal,guild_id,attack_limit,attacks_used,turn_state,version
         FROM guild_territory_turns WHERE war_id=? AND generation_version=? AND guild_id=? LIMIT 1 FOR UPDATE`,
        [war.id, currentTurn.generation_version, actor.guild_id]
      ))[0];
      if (actorTurn === undefined) throw new ApplicationError("GUILD_TERRITORY_ATTACK_GUILD_NOT_READY", "공격 준비가 완료된 길드가 아닙니다.", 403);
      const ready = (await transaction.query<Array<{ ready: number }>>(
        "SELECT ready FROM guild_territory_ready_guilds WHERE war_id=? AND guild_id=? FOR UPDATE", [war.id, actor.guild_id]
      ))[0];
      if (ready?.ready !== 1) throw new ApplicationError("GUILD_TERRITORY_ATTACK_GUILD_NOT_READY", "공격 준비가 완료된 길드가 아닙니다.", 403);
      await this.ensureAttackStates(transaction, war.id, currentTurn.generation_version, actor);
      const guildState = await this.loadGuildState(transaction, war.id, currentTurn.generation_version, actor.guild_id);
      const playerState = await this.loadPlayerState(transaction, war.id, currentTurn.generation_version, actor.player_id);
      if (guildState.eliminated === 1 || playerState.eliminated === 1) {
        throw new ApplicationError("GUILD_TERRITORY_ATTACK_ELIMINATED", "탈락 상태에서는 영지를 공격할 수 없습니다.", 409);
      }
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), IDEMPOTENCY_SCOPE, eventKey, actor.player_id]
      );
      if (currentTurn.guild_id !== actor.guild_id) {
        return this.applyWrongTurnPenalty(transaction, input, eventKey, operation.insertId, policy, actor, war, actorTurn, playerState);
      }
      if (playerState.attacks_used >= policy.personal_attack_limit) {
        throw new ApplicationError("GUILD_TERRITORY_ATTACK_PERSONAL_LIMIT", "개인 영지공격 횟수를 모두 사용했습니다.", 409);
      }
      if (currentTurn.attacks_used >= currentTurn.attack_limit) {
        throw new ApplicationError("GUILD_TERRITORY_ATTACK_GUILD_LIMIT", "길드 공격 횟수를 모두 사용했습니다.", 409);
      }
      await this.requireTargetFeature(transaction, input.targetNo);
      const occupations = await transaction.query<OccupationRow[]>(
        "SELECT territory_no,territory_name,owner_guild_id,owner_player_id FROM guild_territory_occupations WHERE war_id=? ORDER BY territory_no FOR UPDATE", [war.id]
      );
      if (occupations.length !== 7) throw new ApplicationError("GUILD_TERRITORY_ATTACK_OCCUPATIONS_INVALID", "영지 7곳의 상태가 완전하지 않습니다.", 409);
      const ownedCount = occupations.filter((row) => row.owner_guild_id === actor.guild_id).length;
      const fund = policy.turn_fund * BigInt(ownedCount >= policy.max_owned_territories ? policy.max_owned_fund_multiplier : 1);
      const playerAttacksUsed = playerState.attacks_used + 1;
      let guildAttacksUsed = currentTurn.attacks_used + 1;
      const playerCountWrite = await transaction.execute(
        "UPDATE guild_territory_player_attack_states SET attacks_used=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE war_id=? AND generation_version=? AND player_id=? AND version=?",
        [playerAttacksUsed, war.id, currentTurn.generation_version, actor.player_id, playerState.version]
      );
      if (playerCountWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_PLAYER_VERSION_CONFLICT", "개인 공격 상태가 먼저 변경되었습니다.", 409);
      await this.grantTurnFund(transaction, operation.insertId, actor.guild_id, fund);
      const ledgerSequence = { value: 0 };
      await this.applyContributionMedal(transaction, operation.insertId, input, war, currentTurn.generation_version, actor, policy, ledgerSequence);
      let status: GuildTerritoryAttackResult["status"] = "attacked";
      let resultCode = "defender_win";
      let releasedTerritoryNo: number | null = null;
      let winnerPlayerId: string | null = null;
      let riftEventStatus: "rift" | "great_rift" | null = null;
      let riftTargetGuildId: string | null = null;
      if (input.targetNo === 8) {
        status = "dimension";
        const draw = await this.persistDraw(transaction, operation.insertId, input, war, currentTurn.generation_version, "dimension_outcome", policy.dimension_eliminate_bps);
        if (draw.hit) {
          const extra = Math.min(policy.dimension_player_penalty, Math.max(0, currentTurn.attack_limit - guildAttacksUsed));
          guildAttacksUsed += extra;
          await transaction.execute(
            "UPDATE guild_territory_player_attack_states SET eliminated=TRUE,dimension_penalty_turns=dimension_penalty_turns+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE war_id=? AND generation_version=? AND player_id=?",
            [policy.dimension_player_penalty, war.id, currentTurn.generation_version, actor.player_id]
          );
          resultCode = "dimension_player_eliminated";
        } else {
          const extra = Math.min(policy.dimension_attack_penalty, Math.max(0, currentTurn.attack_limit - guildAttacksUsed));
          guildAttacksUsed += extra;
          resultCode = "dimension_guild_penalty";
        }
      } else if (input.targetNo === 9) {
        status = "remember";
        const success = await this.persistDraw(transaction, operation.insertId, input, war, currentTurn.generation_version, "remember_success", policy.remember_success_bps);
        if (success.hit) {
          const occupied = occupations.filter((row) => row.owner_guild_id !== null);
          if (occupied.length > 0) {
            const selection = await this.persistDraw(transaction, operation.insertId, input, war, currentTurn.generation_version, "remember_release_selection", null);
            const released = occupied[selection.bps % occupied.length]!;
            releasedTerritoryNo = Number(released.territory_no);
            await this.releaseTerritory(transaction, war.id, releasedTerritoryNo);
            resultCode = "remember_released";
          } else resultCode = "remember_no_occupied_territory";
        } else resultCode = "remember_failed";
      } else if (input.targetNo === 7 && ownedCount >= policy.max_owned_territories) {
        status = "blocked_max_owned";
        resultCode = "max_owned_territories";
      } else {
        const target = occupations[input.targetNo - 1]!;
        const combat = await this.resolveNormalAttack(transaction, operation.insertId, input, war, currentTurn.generation_version, actor, target, policy, ledgerSequence);
        resultCode = combat.resultCode;
        winnerPlayerId = combat.winnerPlayerId;
      }
      if (input.targetNo <= 7 && status === "attacked") {
        const rift = await this.evaluateRift(transaction, operation.insertId, input, war, currentTurn.generation_version, policy);
        riftEventStatus = rift.status;
        riftTargetGuildId = rift.targetGuildId;
      }
      const turnAdvance = await this.advanceTurn(transaction, war, currentTurn, guildAttacksUsed);
      const warVersionAfterAttack = war.version + 1n;
      const warWrite = await transaction.execute(
        "UPDATE guild_territory_wars SET current_turn_no=?,version=version+1 WHERE id=? AND version=?",
        [turnAdvance.currentTurnNo, war.id, war.version]
      );
      if (warWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_VERSION_CONFLICT", "길드 영지전 상태가 먼저 변경되었습니다.", 409);
      let finishResult: GuildTerritoryWarFinishResult | null = null;
      if (turnAdvance.finished) {
        const scopedFinish = new GuildTerritoryWarFinishService(createScopedDatabaseClient(transaction));
        finishResult = await scopedFinish.finish({ eventId: input.eventId, channelId: input.channelId, trigger: "auto", expectedWarVersion: warVersionAfterAttack });
      }
      const data = this.formatReply(status, resultCode, input.targetNo, releasedTerritoryNo);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      const audit = await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild_territory_war',?,'guild.territory.attack.execute',?,'Iris guild territory attack',?,UTC_TIMESTAMP(3))",
        [operation.insertId, actor.player_id, war.id, resultCode, JSON.stringify({ targetNo: input.targetNo, playerAttacksUsed, guildAttacksUsed, releasedTerritoryNo, winnerPlayerId, finishStatus: finishResult?.status ?? null })]
      );
      const result: GuildTerritoryAttackResult = {
        status, resultCode, warId: war.id.toString(), guildId: actor.guild_id.toString(), playerId: actor.player_id.toString(), targetNo: input.targetNo,
        playerAttacksUsed, guildAttacksUsed, guildAttackLimit: currentTurn.attack_limit, warVersionBefore: war.version.toString(),
        warVersionAfter: (finishResult === null ? warVersionAfterAttack : BigInt(finishResult.warVersionAfter)).toString(), releasedTerritoryNo,
        winnerPlayerId, riftEventStatus, riftTargetGuildId, finishResult, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
      };
      await this.completeOperation(transaction, input.eventId, eventKey, operation.insertId, policy, actor, war, currentTurn.generation_version, input.targetNo, result);
      return result;
    }));
  }

  // 이미 완료된 같은 event의 저장 결과를 그대로 반환합니다.
  private async findReplay(transaction: DatabaseTransaction, eventKey: string): Promise<GuildTerritoryAttackResult | null> {
    const row = (await transaction.query<Array<{ result_json: string | GuildTerritoryAttackResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [IDEMPOTENCY_SCOPE, eventKey]
    ))[0];
    if (row?.result_json == null) return null;
    return typeof row.result_json === "string" ? JSON.parse(row.result_json) as GuildTerritoryAttackResult : row.result_json;
  }

  // 완전한 근거가 있는 ACTIVE 정책 한 건만 잠그고 반환합니다.
  private async loadActivePolicy(transaction: DatabaseTransaction): Promise<AttackPolicyRow> {
    const policy = (await transaction.query<AttackPolicyRow[]>(
      `SELECT policy_version,status,personal_attack_limit,max_owned_territories,wrong_turn_penalty,dimension_eliminate_bps,
              dimension_player_penalty,dimension_attack_penalty,remember_success_bps,turn_fund,max_owned_fund_multiplier,
              defense_ticket_item_code,defense_ticket_bps,attack_ticket_item_code,attack_ticket_bps,
              contribution_medal_item_code,contribution_medal_bps,contribution_medal_quantity,evidence_label,
              rift_event_base_bps,instability_bps_per_point,normal_rift_base_bps,rift_bias_bps_per_point,rift_evidence_label
       FROM guild_territory_attack_policy_versions WHERE policy_scope_code=? AND status='ACTIVE'
       ORDER BY policy_version DESC LIMIT 1 FOR UPDATE`, [POLICY_SCOPE]
    ))[0];
    if (policy === undefined || policy.contribution_medal_bps === null || policy.contribution_medal_quantity === null || policy.evidence_label === null ||
        policy.rift_event_base_bps === null || policy.instability_bps_per_point === null || policy.normal_rift_base_bps === null ||
        policy.rift_bias_bps_per_point === null || policy.rift_evidence_label === null) {
      throw new ApplicationError("GUILD_TERRITORY_ATTACK_POLICY_INCOMPLETE", "영지공격 정책 근거가 완성되지 않아 실행을 중단했습니다.", 503);
    }
    return policy;
  }

  // active player와 길드 멤버십 및 검장·전투사령관 길드장 권한을 함께 확인합니다.
  private async loadActor(transaction: DatabaseTransaction, externalUserId: string): Promise<ActorRow> {
    const actor = (await transaction.query<ActorRow[]>(
      `SELECT player.id player_id,member.guild_id,identity.display_name
       FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active'
       JOIN guild_members member ON member.player_id=player.id
       JOIN guilds guild_row ON guild_row.id=member.guild_id AND guild_row.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND EXISTS (
           SELECT 1 FROM guild_territory_rift_authorizations auth
           WHERE auth.guild_id=member.guild_id AND auth.player_id=player.id AND auth.active=TRUE
             AND (auth.authority_code='sword_master' OR (
               auth.authority_code='combat_commander' AND EXISTS (
                 SELECT 1 FROM guild_leadership_state leadership
                 WHERE leadership.guild_id=member.guild_id AND leadership.master_player_id=player.id
               )
             ))
         )
       LIMIT 1 FOR UPDATE`, [externalUserId]
    ))[0];
    if (actor === undefined) throw new ApplicationError("GUILD_TERRITORY_ATTACK_ACTOR_DENIED", "영지공격 권한이 없습니다.", 403);
    return actor;
  }

  // 회차별 길드와 개인 공격 상태가 없으면 잠금 가능한 초기 행을 만듭니다.
  private async ensureAttackStates(transaction: DatabaseTransaction, warId: bigint, generationVersion: bigint, actor: ActorRow): Promise<void> {
    await transaction.execute(
      "INSERT IGNORE INTO guild_territory_guild_attack_states(war_id,generation_version,guild_id) VALUES (?,?,?)", [warId, generationVersion, actor.guild_id]
    );
    await transaction.execute(
      "INSERT IGNORE INTO guild_territory_player_attack_states(war_id,generation_version,player_id,guild_id) VALUES (?,?,?,?)", [warId, generationVersion, actor.player_id, actor.guild_id]
    );
  }

  // 현재 길드 탈락 상태를 잠가 조회합니다.
  private async loadGuildState(transaction: DatabaseTransaction, warId: bigint, generationVersion: bigint, guildId: bigint): Promise<GuildStateRow> {
    return (await transaction.query<GuildStateRow[]>(
      "SELECT eliminated,version FROM guild_territory_guild_attack_states WHERE war_id=? AND generation_version=? AND guild_id=? FOR UPDATE", [warId, generationVersion, guildId]
    ))[0]!;
  }

  // 현재 개인 공격 횟수와 탈락 상태를 잠가 조회합니다.
  private async loadPlayerState(transaction: DatabaseTransaction, warId: bigint, generationVersion: bigint, playerId: bigint): Promise<PlayerStateRow> {
    return (await transaction.query<PlayerStateRow[]>(
      "SELECT attacks_used,dimension_penalty_turns,eliminated,version FROM guild_territory_player_attack_states WHERE war_id=? AND generation_version=? AND player_id=? FOR UPDATE", [warId, generationVersion, playerId]
    ))[0]!;
  }

  // 차원의 문과 기억 이벤트가 비활성인 특수 target을 fail-closed 합니다.
  private async requireTargetFeature(transaction: DatabaseTransaction, targetNo: number): Promise<void> {
    if (targetNo === 8) {
      const row = (await transaction.query<Array<{ dimension_gate_enabled: number }>>(
        "SELECT dimension_gate_enabled FROM guild_territory_war_control WHERE control_code='current' FOR UPDATE"
      ))[0];
      if (row?.dimension_gate_enabled !== 1) throw new ApplicationError("GUILD_TERRITORY_DIMENSION_DISABLED", "현재 차원의 문이 닫혀 있습니다.", 409);
    }
    if (targetNo === 9) {
      const row = (await transaction.query<Array<{ remember_event_enabled: number }>>(
        "SELECT remember_event_enabled FROM guild_territory_attack_feature_controls WHERE control_code='current' FOR UPDATE"
      ))[0];
      if (row?.remember_event_enabled !== 1) throw new ApplicationError("GUILD_TERRITORY_REMEMBER_DISABLED", "현재 기억의 문이 닫혀 있습니다.", 409);
    }
  }

  // 잘못된 길드 턴에는 5회 페널티를 적용하고 잔여량이 부족하면 길드를 탈락시킵니다.
  private async applyWrongTurnPenalty(transaction: DatabaseTransaction, input: GuildTerritoryAttackInput, eventKey: string, operationId: bigint, policy: AttackPolicyRow, actor: ActorRow, war: WarRow, actorTurn: TurnRow, playerState: PlayerStateRow): Promise<GuildTerritoryAttackResult> {
    const remaining = Math.max(0, actorTurn.attack_limit - actorTurn.attacks_used);
    const eliminated = remaining < policy.wrong_turn_penalty;
    const penalty = eliminated ? remaining : policy.wrong_turn_penalty;
    const guildAttacksUsed = actorTurn.attacks_used + penalty;
    const playerAttacksUsed = Math.min(policy.personal_attack_limit, playerState.attacks_used + penalty);
    const turnWrite = await transaction.execute(
      "UPDATE guild_territory_turns SET attacks_used=?,turn_state=CASE WHEN ? THEN 'SKIPPED' ELSE turn_state END,version=version+1 WHERE war_id=? AND generation_version=? AND ordinal=? AND version=?",
      [guildAttacksUsed, eliminated, war.id, actorTurn.generation_version, actorTurn.ordinal, actorTurn.version]
    );
    if (turnWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_TURN_VERSION_CONFLICT", "길드 공격 턴이 먼저 변경되었습니다.", 409);
    const playerWrite = await transaction.execute(
      "UPDATE guild_territory_player_attack_states SET attacks_used=?,eliminated=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE war_id=? AND generation_version=? AND player_id=? AND version=?",
      [playerAttacksUsed, war.id, actorTurn.generation_version, actor.player_id, playerState.version]
    );
    if (playerWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_PLAYER_VERSION_CONFLICT", "개인 공격 상태가 먼저 변경되었습니다.", 409);
    if (eliminated) await transaction.execute(
      "UPDATE guild_territory_guild_attack_states SET eliminated=TRUE,elimination_reason='wrong_turn',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE war_id=? AND generation_version=? AND guild_id=?",
      [war.id, actorTurn.generation_version, actor.guild_id]
    );
    const warWrite = await transaction.execute("UPDATE guild_territory_wars SET version=version+1 WHERE id=? AND version=?", [war.id, war.version]);
    if (warWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_VERSION_CONFLICT", "길드 영지전 상태가 먼저 변경되었습니다.", 409);
    const resultCode = eliminated ? "wrong_turn_eliminated" : "wrong_turn_penalty";
    const data = eliminated ? "잘못된 공격 턴으로 길드가 탈락했습니다." : `잘못된 공격 턴으로 ${penalty}회의 페널티가 적용되었습니다.`;
    const outbox = await transaction.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [operationId, input.channelId, JSON.stringify({ data })]
    );
    const audit = await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'guild_territory_war',?,'guild.territory.attack.execute',?,'wrong guild turn',?,UTC_TIMESTAMP(3))",
      [operationId, actor.player_id, war.id, resultCode, JSON.stringify({ penalty, eliminated, guildAttacksUsed, playerAttacksUsed })]
    );
    const result: GuildTerritoryAttackResult = { status: "wrong_turn_penalty", resultCode, warId: war.id.toString(), guildId: actor.guild_id.toString(), playerId: actor.player_id.toString(), targetNo: input.targetNo, playerAttacksUsed, guildAttacksUsed, guildAttackLimit: actorTurn.attack_limit, warVersionBefore: war.version.toString(), warVersionAfter: (war.version + 1n).toString(), releasedTerritoryNo: null, winnerPlayerId: null, riftEventStatus: null, riftTargetGuildId: null, finishResult: null, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
    await this.completeOperation(transaction, input.eventId, eventKey, operationId, policy, actor, war, actorTurn.generation_version, input.targetNo, result);
    return result;
  }

  // 길드 보유 영지 수에 따른 턴 기금을 계정과 원장에 반영합니다.
  private async grantTurnFund(transaction: DatabaseTransaction, operationId: bigint, guildId: bigint, amount: bigint): Promise<void> {
    await transaction.execute("INSERT IGNORE INTO guild_resource_accounts(guild_id,currency_code,balance,version) VALUES (?,'POINT',0,1)", [guildId]);
    const account = (await transaction.query<Array<{ balance: string; version: bigint }>>(
      "SELECT CAST(balance AS CHAR) balance,version FROM guild_resource_accounts WHERE guild_id=? AND currency_code='POINT' FOR UPDATE", [guildId]
    ))[0];
    if (account === undefined) throw new ApplicationError("GUILD_TERRITORY_ATTACK_FUND_ACCOUNT_MISSING", "길드 기금 계정을 찾을 수 없습니다.", 409);
    const balance = decimalInteger(account.balance) + amount;
    const write = await transaction.execute(
      "UPDATE guild_resource_accounts SET balance=?,version=version+1 WHERE guild_id=? AND currency_code='POINT' AND version=?", [balance, guildId, account.version]
    );
    if (write.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_FUND_CONFLICT", "길드 기금이 먼저 변경되었습니다.", 409);
    await transaction.execute(
      "INSERT INTO guild_resource_ledger(operation_id,sequence_no,guild_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'POINT',?,?,'guild_territory_turn_fund')",
      [operationId, guildId, amount, balance]
    );
  }

  // fixture가 확정한 훈장 확률과 수량으로 독립 RNG 보상을 처리합니다.
  private async applyContributionMedal(transaction: DatabaseTransaction, operationId: bigint, input: GuildTerritoryAttackInput, war: WarRow, generationVersion: bigint, actor: ActorRow, policy: AttackPolicyRow, ledgerSequence: { value: number }): Promise<void> {
    const draw = await this.persistDraw(transaction, operationId, input, war, generationVersion, "contribution_medal", policy.contribution_medal_bps!);
    if (draw.hit) await this.grantItem(transaction, operationId, actor.player_id, policy.contribution_medal_item_code, policy.contribution_medal_quantity!, "guild_territory_contribution_medal", ledgerSequence);
  }

  // DB 정책의 선형 계수로 공격 후 균열을 판정하고 발생 상태를 원자 기록합니다.
  private async evaluateRift(transaction: DatabaseTransaction, operationId: bigint, input: GuildTerritoryAttackInput, war: WarRow, generationVersion: bigint, policy: AttackPolicyRow): Promise<{ status: "rift" | "great_rift" | null; targetGuildId: string | null }> {
    const eventThreshold = clampBps(Math.round(policy.rift_event_base_bps! + Number(war.instability_adjust) * policy.instability_bps_per_point!));
    const eventDraw = await this.persistDraw(transaction, operationId, input, war, generationVersion, "rift_event", eventThreshold);
    if (!eventDraw.hit) return { status: null, targetGuildId: null };
    const normalThreshold = clampBps(Math.round(policy.normal_rift_base_bps! + Number(war.rift_bias) * policy.rift_bias_bps_per_point!));
    const typeDraw = await this.persistDraw(transaction, operationId, input, war, generationVersion, "rift_type", normalThreshold);
    const status: "rift" | "great_rift" = typeDraw.hit ? "rift" : "great_rift";
    let targetGuildId: bigint | null = null;
    if (status === "great_rift") {
      const candidates = await transaction.query<Array<{ guild_id: bigint }>>(
        `SELECT ready.guild_id FROM guild_territory_ready_guilds ready
         LEFT JOIN guild_territory_guild_attack_states state_row
           ON state_row.war_id=ready.war_id AND state_row.generation_version=? AND state_row.guild_id=ready.guild_id
         WHERE ready.war_id=? AND ready.ready=TRUE AND COALESCE(state_row.eliminated,FALSE)=FALSE ORDER BY ready.guild_id FOR UPDATE`,
        [generationVersion, war.id]
      );
      if (candidates.length > 0) {
        const targetDraw = await this.persistDraw(transaction, operationId, input, war, generationVersion, "great_rift_target", null);
        targetGuildId = candidates[targetDraw.bps % candidates.length]!.guild_id;
      }
    }
    const before = { instabilityAdjust: war.instability_adjust, riftBias: war.rift_bias, eventCount: war.rift_event_count.toString() };
    const eventCountAfter = war.rift_event_count + 1n;
    const historyEntry = { status, targetGuildId: targetGuildId?.toString() ?? null, operationId: operationId.toString() };
    await transaction.execute(
      "UPDATE guild_territory_wars SET instability_adjust=0,rift_event_status=?,rift_event_count=?,rift_event_history_json=JSON_ARRAY_APPEND(rift_event_history_json,'$',JSON_EXTRACT(?,'$')),rift_event_at=UTC_TIMESTAMP(3),rift_event_guild_id=? WHERE id=?",
      [status, eventCountAfter, JSON.stringify(historyEntry), targetGuildId, war.id]
    );
    const after = { instabilityAdjust: "0", riftBias: war.rift_bias, eventCount: eventCountAfter.toString(), ...historyEntry };
    await transaction.execute(
      "INSERT INTO guild_territory_rift_events(operation_id,war_id,event_type,target_guild_id,event_count_after,state_before_json,state_after_json) VALUES (?,?,?,?,?,?,?)",
      [operationId, war.id, status, targetGuildId, eventCountAfter, JSON.stringify(before), JSON.stringify(after)]
    );
    return { status, targetGuildId: targetGuildId?.toString() ?? null };
  }

  // 방어권, 기습공격권, snapshot 치명타 순으로 일반 영지 전투를 판정합니다.
  private async resolveNormalAttack(transaction: DatabaseTransaction, operationId: bigint, input: GuildTerritoryAttackInput, war: WarRow, generationVersion: bigint, actor: ActorRow, target: OccupationRow, policy: AttackPolicyRow, ledgerSequence: { value: number }): Promise<{ resultCode: string; winnerPlayerId: string | null }> {
    if (target.owner_guild_id === actor.guild_id) return { resultCode: "self_owned_territory", winnerPlayerId: actor.player_id.toString() };
    if (target.owner_player_id === null || target.owner_guild_id === null) {
      await this.occupyTerritory(transaction, war.id, Number(target.territory_no), actor);
      return { resultCode: "unoccupied_captured", winnerPlayerId: actor.player_id.toString() };
    }
    const attacker = await this.loadSnapshot(transaction, war.id, generationVersion, actor.player_id, actor.guild_id);
    const defender = await this.loadSnapshot(transaction, war.id, generationVersion, target.owner_player_id, target.owner_guild_id);
    const defenseAvailable = await this.hasStack(transaction, target.owner_player_id, policy.defense_ticket_item_code);
    if (defenseAvailable) {
      await this.consumeItem(transaction, operationId, target.owner_player_id, policy.defense_ticket_item_code, "guild_territory_defense_ticket", ledgerSequence);
      const defense = await this.persistDraw(transaction, operationId, input, war, generationVersion, "defense_ticket", policy.defense_ticket_bps);
      if (defense.hit) return { resultCode: "defense_ticket_win", winnerPlayerId: target.owner_player_id.toString() };
    }
    const attackAvailable = await this.hasStack(transaction, actor.player_id, policy.attack_ticket_item_code);
    if (attackAvailable) {
      await this.consumeItem(transaction, operationId, actor.player_id, policy.attack_ticket_item_code, "guild_territory_attack_ticket", ledgerSequence);
      const surprise = await this.persistDraw(transaction, operationId, input, war, generationVersion, "attack_ticket", policy.attack_ticket_bps);
      if (surprise.hit) {
        const contributionDefense = await this.persistDraw(transaction, operationId, input, war, generationVersion, "contribution_cube_defense", defender.surprise_defense_bonus_bps);
        if (contributionDefense.hit) return { resultCode: "contribution_cube_defense_win", winnerPlayerId: target.owner_player_id.toString() };
        await this.occupyTerritory(transaction, war.id, Number(target.territory_no), actor);
        return { resultCode: "attack_ticket_win", winnerPlayerId: actor.player_id.toString() };
      }
    }
    const attackerDraw = await this.persistDraw(transaction, operationId, input, war, generationVersion, "attacker_critical", attacker.critical_bps);
    const defenderDraw = await this.persistDraw(transaction, operationId, input, war, generationVersion, "defender_critical", defender.critical_bps);
    const combat = resolveGuildTerritorySnapshotCombat({ attacker, defender, attackerDrawBps: attackerDraw.bps, defenderDrawBps: defenderDraw.bps });
    await transaction.execute(
      "INSERT INTO guild_territory_attack_events(operation_id,event_code,before_json,after_json) VALUES (?,'normal_combat',?,?)",
      [operationId, JSON.stringify({ territoryNo: Number(target.territory_no), ownerGuildId: target.owner_guild_id.toString(), ownerPlayerId: target.owner_player_id.toString() }), JSON.stringify({ attackerCritical: combat.attackerCritical, defenderCritical: combat.defenderCritical, attackerFinalCharm: combat.attackerFinalCharm.toString(), defenderFinalCharm: combat.defenderFinalCharm.toString(), attackerWins: combat.attackerWins })]
    );
    if (combat.attackerWins) {
      await this.occupyTerritory(transaction, war.id, Number(target.territory_no), actor);
      return { resultCode: "snapshot_attacker_win", winnerPlayerId: actor.player_id.toString() };
    }
    return { resultCode: "snapshot_defender_win", winnerPlayerId: target.owner_player_id.toString() };
  }

  // 시작 시 고정된 전투 snapshot을 길드 일치까지 확인해 불러옵니다.
  private async loadSnapshot(transaction: DatabaseTransaction, warId: bigint, generationVersion: bigint, playerId: bigint, guildId: bigint): Promise<SnapshotRow> {
    const row = (await transaction.query<SnapshotRow[]>(
      "SELECT player_id,guild_id,castle_charm,critical_bps,critical_multiplier_bps,surprise_defense_bonus_bps,pet_snapshot_json FROM guild_territory_combat_snapshots WHERE war_id=? AND generation_version=? AND player_id=? FOR UPDATE",
      [warId, generationVersion, playerId]
    ))[0];
    if (row === undefined || row.guild_id !== guildId) throw new ApplicationError("GUILD_TERRITORY_ATTACK_SNAPSHOT_MISSING", "영지전 시작 snapshot이 없어 공격을 중단했습니다.", 503);
    return row;
  }

  // stack 보유 여부를 잠가 확인합니다.
  private async hasStack(transaction: DatabaseTransaction, playerId: bigint, itemCode: string): Promise<boolean> {
    const item = await this.loadItemStack(transaction, playerId, itemCode);
    return item.quantity > 0n;
  }

  // item 정의와 개인 stack을 잠가 반환합니다.
  private async loadItemStack(transaction: DatabaseTransaction, playerId: bigint, itemCode: string): Promise<ItemRow> {
    const definition = (await transaction.query<Array<{ id: bigint }>>(
      "SELECT id FROM item_definitions WHERE code=? AND active=TRUE FOR UPDATE", [itemCode]
    ))[0];
    if (definition === undefined) throw new ApplicationError("GUILD_TERRITORY_ATTACK_ITEM_UNDEFINED", `영지공격 아이템 ${itemCode} 정의가 없습니다.`, 503);
    await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,1)", [playerId, definition.id]);
    const stack = (await transaction.query<Array<{ quantity: bigint }>>(
      "SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [playerId, definition.id]
    ))[0]!;
    return { id: definition.id, quantity: stack.quantity };
  }

  // 확률 판정에 사용한 stack item 한 개를 차감하고 원장을 남깁니다.
  private async consumeItem(transaction: DatabaseTransaction, operationId: bigint, playerId: bigint, itemCode: string, reasonCode: string, ledgerSequence: { value: number }): Promise<void> {
    const item = await this.loadItemStack(transaction, playerId, itemCode);
    if (item.quantity < 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_ITEM_SHORTAGE", "영지공격 아이템 수량이 부족합니다.", 409);
    await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND quantity>=1", [playerId, item.id]);
    ledgerSequence.value++;
    await transaction.execute(
      "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,?,?,?,NULL,-1,?)",
      [operationId, ledgerSequence.value, playerId, item.id, reasonCode]
    );
  }

  // 확정된 공헌훈장을 개인 stack과 원장에 지급합니다.
  private async grantItem(transaction: DatabaseTransaction, operationId: bigint, playerId: bigint, itemCode: string, quantity: bigint, reasonCode: string, ledgerSequence: { value: number }): Promise<void> {
    const item = await this.loadItemStack(transaction, playerId, itemCode);
    await transaction.execute("UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=?", [quantity, playerId, item.id]);
    ledgerSequence.value++;
    await transaction.execute(
      "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,?,?,?,NULL,?,?)",
      [operationId, ledgerSequence.value, playerId, item.id, quantity, reasonCode]
    );
  }

  // 이벤트 기반 deterministic draw를 원장에 저장하고 기준 확률의 적중 여부를 반환합니다.
  private async persistDraw(transaction: DatabaseTransaction, operationId: bigint, input: GuildTerritoryAttackInput, war: WarRow, generationVersion: bigint, drawCode: string, thresholdBps: number | null): Promise<{ bps: number; hit: boolean }> {
    const count = (await transaction.query<Array<{ draw_count: bigint }>>(
      "SELECT COUNT(*) draw_count FROM guild_territory_attack_random_draws WHERE operation_id=? FOR UPDATE", [operationId]
    ))[0]?.draw_count ?? 0n;
    const bps = deterministicGuildTerritoryDrawBps(`${normalizeEventKey(input.eventId)}|${war.id}|${generationVersion}|${drawCode}`);
    const hit = thresholdBps !== null && bps < thresholdBps;
    await transaction.execute(
      "INSERT INTO guild_territory_attack_random_draws(operation_id,sequence_no,draw_code,draw_bps,outcome_code) VALUES (?,?,?,?,?)",
      [operationId, Number(count) + 1, drawCode, bps, thresholdBps === null ? "selected" : hit ? "hit" : "miss"]
    );
    return { bps, hit };
  }

  // 공격 승리 시 점령자와 1번 영지의 성주 snapshot을 함께 변경합니다.
  private async occupyTerritory(transaction: DatabaseTransaction, warId: bigint, territoryNo: number, actor: ActorRow): Promise<void> {
    await transaction.execute(
      "UPDATE guild_territory_occupations SET owner_guild_id=?,owner_player_id=?,occupied_at=UTC_TIMESTAMP(3),version=version+1 WHERE war_id=? AND territory_no=?",
      [actor.guild_id, actor.player_id, warId, territoryNo]
    );
    if (territoryNo === 1) await transaction.execute(
      "UPDATE guild_territory_wars SET castle_lord_player_id=?,castle_earnings=0,castle_defense_count=0 WHERE id=?", [actor.player_id, warId]
    );
  }

  // 기억 이벤트가 고른 점령지를 해제하고 1번이면 성 관련 필드를 초기화합니다.
  private async releaseTerritory(transaction: DatabaseTransaction, warId: bigint, territoryNo: number): Promise<void> {
    await transaction.execute(
      "UPDATE guild_territory_occupations SET owner_guild_id=NULL,owner_player_id=NULL,occupied_at=NULL,version=version+1 WHERE war_id=? AND territory_no=?", [warId, territoryNo]
    );
    if (territoryNo === 1) await transaction.execute(
      "UPDATE guild_territory_wars SET castle_lord_player_id=NULL,castle_earnings=0,castle_defense_count=0 WHERE id=?", [warId]
    );
  }

  // 현재 턴 소진 시 다음 비탈락 길드를 활성화하고 없으면 종료 대상으로 표시합니다.
  private async advanceTurn(transaction: DatabaseTransaction, war: WarRow, currentTurn: TurnRow, attacksUsed: number): Promise<{ currentTurnNo: bigint; finished: boolean }> {
    const turnState = attacksUsed < currentTurn.attack_limit ? currentTurn.turn_state : "COMPLETED";
    const currentWrite = await transaction.execute(
      "UPDATE guild_territory_turns SET attacks_used=?,turn_state=?,version=version+1 WHERE war_id=? AND generation_version=? AND ordinal=? AND version=?",
      [attacksUsed, turnState, war.id, currentTurn.generation_version, currentTurn.ordinal, currentTurn.version]
    );
    if (currentWrite.affectedRows !== 1n) throw new ApplicationError("GUILD_TERRITORY_ATTACK_TURN_VERSION_CONFLICT", "길드 공격 턴이 먼저 변경되었습니다.", 409);
    if (attacksUsed < currentTurn.attack_limit) return { currentTurnNo: currentTurn.ordinal, finished: false };
    const next = (await transaction.query<Array<{ ordinal: bigint }>>(
      `SELECT turn_row.ordinal FROM guild_territory_turns turn_row
       LEFT JOIN guild_territory_guild_attack_states state_row
         ON state_row.war_id=turn_row.war_id AND state_row.generation_version=turn_row.generation_version AND state_row.guild_id=turn_row.guild_id
       WHERE turn_row.war_id=? AND turn_row.generation_version=? AND turn_row.ordinal>? AND turn_row.turn_state='PENDING'
         AND COALESCE(state_row.eliminated,FALSE)=FALSE ORDER BY turn_row.ordinal LIMIT 1 FOR UPDATE`,
      [war.id, currentTurn.generation_version, currentTurn.ordinal]
    ))[0];
    if (next === undefined) return { currentTurnNo: 0n, finished: true };
    await transaction.execute(
      "UPDATE guild_territory_turns SET turn_state='ACTIVE',version=version+1 WHERE war_id=? AND generation_version=? AND ordinal=? AND turn_state='PENDING'", [war.id, currentTurn.generation_version, next.ordinal]
    );
    return { currentTurnNo: next.ordinal, finished: false };
  }

  // 결과 코드별 최소 사용자 응답을 생성합니다.
  private formatReply(status: GuildTerritoryAttackResult["status"], resultCode: string, targetNo: number, releasedTerritoryNo: number | null): string {
    if (status === "blocked_max_owned") return "보유 가능한 영지 3곳을 이미 점령해 7번 영지 전투가 차단되었습니다. 공격 횟수와 턴 기금은 반영되었습니다.";
    if (status === "dimension") return resultCode === "dimension_player_eliminated" ? "차원의 문에서 패배해 개인이 탈락하고 2턴 페널티가 적용되었습니다." : "차원의 문 결과로 길드 공격 횟수에 4회 페널티가 적용되었습니다.";
    if (status === "remember") return releasedTerritoryNo === null ? "기억의 문 공격을 완료했지만 해제된 영지는 없습니다." : `기억의 문이 ${releasedTerritoryNo}번 영지를 해제했습니다.`;
    return `영지 ${targetNo}번 공격을 처리했습니다. (${resultCode})`;
  }

  // 공격 실행·감사 결과를 replay 가능한 operation과 도메인 행에 확정합니다.
  private async completeOperation(transaction: DatabaseTransaction, sourceEventId: string, eventKey: string, operationId: bigint, policy: AttackPolicyRow, actor: ActorRow, war: WarRow, generationVersion: bigint, targetNo: number, result: GuildTerritoryAttackResult): Promise<void> {
    await transaction.execute(
      "INSERT INTO guild_territory_attack_runs(event_key,operation_id,war_id,generation_version,policy_version,player_id,guild_id,target_no,result_code,war_version_before,war_version_after,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [eventKey, operationId, war.id, generationVersion, policy.policy_version, actor.player_id, actor.guild_id, targetNo, result.resultCode, war.version, BigInt(result.warVersionAfter), JSON.stringify(result)]
    );
    await transaction.execute(
      "INSERT INTO guild_territory_attack_events(operation_id,event_code,before_json,after_json) VALUES (?,'attack_state',?,?) ON DUPLICATE KEY UPDATE after_json=VALUES(after_json)",
      [operationId, JSON.stringify({ warVersion: war.version.toString() }), JSON.stringify({ resultCode: result.resultCode, warVersion: result.warVersionAfter, playerAttacksUsed: result.playerAttacksUsed, guildAttacksUsed: result.guildAttacksUsed })]
    );
    await transaction.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [sourceEventId, COMMAND_CODE, operationId, result.resultCode]
    );
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
  }
}

// 긴 외부 event ID를 operation unique key 길이에 맞춰 안정적으로 정규화합니다.
function normalizeEventKey(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 191 ? trimmed : createHash("sha256").update(trimmed).digest("hex");
}

// DECIMAL 문자열의 정수부를 bigint로 변환합니다.
function decimalInteger(value: string): bigint {
  return BigInt(value.split(".")[0] ?? "0");
}

// 확률 계산 결과를 basis-point 유효 범위로 제한합니다.
function clampBps(value: number): number {
  return Math.max(0, Math.min(10000, value));
}

// MariaDB deadlock과 lock timeout만 제한적으로 재시도합니다.
async function retryDeadlock<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      const databaseError = error as { errno?: number; code?: string };
      if (attempt >= 2 || (databaseError.errno !== 1213 && databaseError.errno !== 1205 && databaseError.code !== "ER_LOCK_DEADLOCK" && databaseError.code !== "ER_LOCK_WAIT_TIMEOUT")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
