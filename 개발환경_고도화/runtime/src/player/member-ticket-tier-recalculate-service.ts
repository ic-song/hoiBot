import { randomUUID } from "node:crypto";
import { createScopedDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { calculateTierTransitionDelta, resolveTierByTickets, TierAuthorityProvider, type TierDefinition } from "./tier-authority-provider.js";

const SCOPE = "player.tier.recalculate";
const REGULAR_TICKET_CODE = "ITEM-RWD-022";
const ADVANCED_TICKET_CODE = "tier_advanced_ticket";

interface PlayerRow {
  player_id: bigint;
  display_name: string | null;
  tier_code: string | null;
  profile_version: bigint | null;
  pet_id: bigint | null;
  pet_experience: bigint | null;
  pet_version: bigint | null;
  rank_player_id: bigint | null;
}

interface TicketRow {
  player_id: bigint;
  item_code: string;
  quantity: bigint;
}

export interface TierRecalculationMember {
  playerId: bigint;
  displayName: string;
  currentTierCode: string;
  petExperience: bigint;
  regularTickets: bigint;
  advancedTickets: bigint;
}

export interface TierRecalculationChange {
  playerId: bigint;
  displayName: string;
  fromTier: TierDefinition;
  toTier: TierDefinition;
  experienceDelta: bigint;
  nextPetExperience: bigint;
}

export interface TierRecalculationResult {
  status: "completed";
  data: string;
  outboxId: string;
  scannedCount: number;
  changedCount: number;
  tierVersionCode: string;
}

// 회원별 티켓 수량과 현재 티어를 authoritative catalog에 대조해 변경 계획을 계산합니다.
export function buildTierRecalculationPlan(definitions: readonly TierDefinition[], members: readonly TierRecalculationMember[]): TierRecalculationChange[] {
  const byCode = new Map(definitions.map((definition) => [definition.tierCode, definition]));
  const changes: TierRecalculationChange[] = [];
  for (const member of members) {
    const fromTier = byCode.get(member.currentTierCode);
    if (fromTier === undefined) throw new ApplicationError("TIER_CURRENT_CODE_INVALID", `${member.displayName}님의 현재 티어가 카탈로그에 없습니다.`, 409);
    const toTier = resolveTierByTickets(definitions, member.regularTickets, member.advancedTickets);
    if (toTier.tierCode === fromTier.tierCode) continue;
    const experienceDelta = calculateTierTransitionDelta(definitions, fromTier.tierCode, toTier.tierCode);
    const nextPetExperience = member.petExperience + experienceDelta < 0n ? 0n : member.petExperience + experienceDelta;
    changes.push({ playerId: member.playerId, displayName: member.displayName, fromTier, toTier, experienceDelta, nextPetExperience });
  }
  return changes;
}

// legacy와 같은 회원별 티어 변경·펫 경험치 결과 메시지를 만듭니다.
function formatResult(changes: readonly TierRecalculationChange[]): string {
  if (changes.length === 0) return "✅ 티어 변경 대상이 없습니다.";
  const lines = ["🔔 티어 변경 확인 🔔", ""];
  for (const change of changes) {
    lines.push(`${change.displayName} - 이전 티어: ${change.fromTier.displayName}`, `새로운 티어: ${change.toTier.displayName}`, "");
    if (change.experienceDelta > 0n) lines.push(`${change.displayName}님 티어 승급을 축하드립니다.`, "티어업 보너스 매력💕을 획득합니다.", `캐슬/레이드 매력추가💕 ${change.experienceDelta}`, "종합매력에x2배 매력이 반영됩니다.", "");
    else if (change.experienceDelta < 0n) lines.push(`${change.displayName}님 티어가 하락되었습니다.`, "펫 매력이 회수됩니다.", `캐슬/레이드 매력감소💔 ${-change.experienceDelta}`, "종합매력에x2배 매력이 반영됩니다.", "");
    else lines.push(`${change.displayName}님의 티어는 변경되었지만 매력 변화는 없습니다.`, "");
  }
  return lines.join("\n").trimEnd();
}

// exact `/티어적용` 명령만 실행 후보로 인정합니다.
export function isMemberTicketTierRecalculateCommand(message: string | undefined): boolean {
  return message === "/티어적용";
}

// DB command alias 조회에 사용할 기본 명령문을 반환합니다.
export function normalizeMemberTicketTierRecalculateDispatchMessage(message: string): string {
  return isMemberTicketTierRecalculateCommand(message) ? "/티어적용" : message;
}

// 전체 회원의 tier/profile·legacy emoji·pet experience를 한 transaction에서 재계산합니다.
export class MemberTicketTierRecalculateService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<TierRecalculationResult> {
    if (!isMemberTicketTierRecalculateCommand(input.message)) throw new ApplicationError("INVALID_TIER_RECALCULATE_COMMAND", "티어 적용 명령 형식이 올바르지 않습니다.", 422);
    const operatorId = await this.requireOperator(input.externalUserId);
    return this.database.withTransaction(async (transaction) => {
      const prior = await readPriorResult(transaction, input.eventId);
      if (prior !== undefined) return prior;

      // publication row 잠금을 outer transaction까지 유지해 서로 다른 전체 재계산 이벤트도 직렬화합니다.
      const authority = await new TierAuthorityProvider(createScopedDatabaseClient(transaction)).loadPublished();
      const itemRows = await transaction.query<Array<{ id: bigint; code: string }>>(
        "SELECT id,code FROM item_definitions WHERE code IN (?,?) AND active=TRUE ORDER BY code FOR UPDATE",
        [REGULAR_TICKET_CODE, ADVANCED_TICKET_CODE]
      );
      if (itemRows.length !== 2) throw new ApplicationError("TIER_TICKET_DEFINITION_REQUIRED", "티어 승급티켓 정의가 완전하지 않습니다.", 409);

      const players = await transaction.query<PlayerRow[]>(
        `SELECT player.id player_id,profile.current_display_name display_name,profile.tier_code,profile.version profile_version,
                pet.id pet_id,pet.experience pet_experience,pet.version pet_version,legacy.player_id rank_player_id
         FROM players player
         LEFT JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN player_pets pet ON pet.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles legacy ON legacy.player_id=player.id
         WHERE player.status='active' AND player.deleted_at IS NULL ORDER BY player.id FOR UPDATE`
      );
      for (const player of players) {
        if (player.display_name === null || player.tier_code === null || player.profile_version === null || player.pet_id === null
          || player.pet_experience === null || player.pet_version === null || player.rank_player_id === null) {
          throw new ApplicationError("TIER_MEMBER_STATE_INCOMPLETE", `회원 ${player.player_id}의 프로필·티어·펫·랭크 데이터가 완전하지 않습니다.`, 409);
        }
      }

      const tickets = await transaction.query<TicketRow[]>(
        `SELECT stack.player_id,item.code item_code,stack.quantity
         FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
         JOIN players player ON player.id=stack.player_id AND player.status='active' AND player.deleted_at IS NULL
         WHERE item.code IN (?,?) ORDER BY stack.player_id,item.code FOR UPDATE`,
        [REGULAR_TICKET_CODE, ADVANCED_TICKET_CODE]
      );
      const counts = new Map<string, bigint>();
      for (const ticket of tickets) counts.set(`${ticket.player_id}:${ticket.item_code}`, BigInt(ticket.quantity));
      const members: TierRecalculationMember[] = players.map((player) => ({
        playerId: player.player_id,
        displayName: player.display_name!,
        currentTierCode: player.tier_code!,
        petExperience: BigInt(player.pet_experience!),
        regularTickets: counts.get(`${player.player_id}:${REGULAR_TICKET_CODE}`) ?? 0n,
        advancedTickets: counts.get(`${player.player_id}:${ADVANCED_TICKET_CODE}`) ?? 0n
      }));
      const changes = buildTierRecalculationPlan(authority.definitions, members);
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), SCOPE, input.eventId, operatorId]
      );
      for (const change of changes) {
        const current = players.find((player) => player.player_id === change.playerId)!;
        const profile = await transaction.execute(
          "UPDATE player_profiles SET tier_code=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
          [change.toTier.tierCode, change.playerId, current.profile_version]
        );
        if (profile.affectedRows !== 1n) throw new ApplicationError("TIER_PROFILE_VERSION_CONFLICT", `${change.displayName}님의 프로필이 먼저 변경되었습니다.`, 409);
        await transaction.execute("UPDATE player_legacy_rank_profiles SET rank_emoji=? WHERE player_id=?", [change.toTier.rankEmoji, change.playerId]);
        const pet = await transaction.execute(
          "UPDATE player_pets SET experience=?,version=version+1 WHERE id=? AND version=?",
          [change.nextPetExperience, current.pet_id, current.pet_version]
        );
        if (pet.affectedRows !== 1n) throw new ApplicationError("TIER_PET_VERSION_CONFLICT", `${change.displayName}님의 펫이 먼저 변경되었습니다.`, 409);
      }
      const data = formatResult(changes);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'MEMBER_TICKET_TIER_RECALCULATE',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',NULL,'player.tier.recalculate','success','Iris /티어적용',?,UTC_TIMESTAMP(3))",
        [operation.insertId, operatorId, JSON.stringify({ tierVersionCode: authority.versionCode, scannedCount: players.length, changedCount: changes.length,
          changes: changes.map((change) => ({ playerId: change.playerId.toString(), fromTierCode: change.fromTier.tierCode, toTierCode: change.toTier.tierCode,
            petExperienceDelta: change.experienceDelta.toString(), nextPetExperience: change.nextPetExperience.toString() })) })]
      );
      const result: TierRecalculationResult = { status: "completed", data, outboxId: outbox.insertId.toString(), scannedCount: players.length,
        changedCount: changes.length, tierVersionCode: authority.versionCode };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  // active super_admin의 전용 티어 재계산 권한을 확인합니다.
  private async requireOperator(externalUserId: string): Promise<string> {
    const rows = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT DISTINCT operator.id operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN admin_operator_roles assignment ON assignment.operator_id=operator.id
       JOIN admin_roles role ON role.id=assignment.role_id AND role.active=TRUE AND role.code='super_admin'
       JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='player.tier.recalculate'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND NOT EXISTS(SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='player.tier.recalculate' AND denied.effect='deny')
       ORDER BY operator.id LIMIT 2`, [externalUserId]
    );
    if (rows.length !== 1) throw new ApplicationError("FORBIDDEN", "티어 적용 권한이 없습니다.", 403);
    return rows[0]!.operator_id.toString();
  }
}

// 같은 이벤트의 완료 결과를 추가 mutation 없이 replay합니다.
async function readPriorResult(transaction: DatabaseTransaction, eventId: string): Promise<TierRecalculationResult | undefined> {
  const rows = await transaction.query<Array<{ result_json: string | TierRecalculationResult | null }>>(
    "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, eventId]
  );
  const prior = rows[0]?.result_json;
  if (prior === undefined || prior === null) return undefined;
  return typeof prior === "string" ? JSON.parse(prior) : prior;
}
