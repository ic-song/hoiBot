import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const SUCCESS_PHRASES = [
  "선빵은 매너 없지만, 결과는 깔끔했습니다.", "말보다 주먹이 빠른 하루였습니다.", "상대가 눈을 깜빡인 사이 승부가 끝났습니다.",
  "명치 교육이 성공적으로 완료되었습니다.", "오늘의 교훈, 함부로 덤비지 말자.", "상대의 전투 의지가 조용히 퇴근했습니다.",
  "가볍게 몸만 풀었는데 상대가 누웠습니다.", "이 구역 품행은 제가 책임집니다.", "상대가 덤볐고, 후회는 빨랐습니다.", "명치에 작은 진심을 담았습니다.",
] as const;
const FAILURE_PHRASES = [
  "폼은 좋았는데 발이 꼬였습니다.", "오늘은 바람이 상대 편이었습니다.", "주먹보다 생각이 먼저 나가버렸습니다.", "상대가 예상보다 단단했습니다.",
  "큰소리친 것치고는 조용히 물러납니다.", "명치를 노렸지만 자존심만 다쳤습니다.", "오늘은 전략적 후퇴입니다. 절대 도망 아닙니다.",
  "주먹이 길을 잃었습니다.", "상대가 강한 게 아니라 제가 잠깐 봐준 겁니다.", "다음엔 준비운동부터 하고 오겠습니다.",
] as const;

export type PetDuelEmoteCommand = { kind: "usage" } | { kind: "duel"; targetName: string };
export interface PetDuelEmoteResult {
  status: "usage" | "emote";
  outcome: "success" | "failure" | null;
  actorPlayerId: string;
  targetPlayerId: string | null;
  reply: { outboxId: string; room: string; data: string };
}

// exact 사용법과 대상 인자형만 결투 후보로 구분합니다.
export function parsePetDuelEmoteCommand(message: string | undefined): PetDuelEmoteCommand | null {
  if (message === "/결투") return { kind: "usage" };
  const match = /^\/결투\s+(.+)$/.exec(message ?? "");
  return match === null ? null : { kind: "duel", targetName: match[1]!.trim() };
}

// 대상 인자형을 DB command alias로 정규화합니다.
export function normalizePetDuelEmoteDispatchMessage(message: string): string {
  return parsePetDuelEmoteCommand(message)?.kind === "duel" ? "/결투 [유저명]" : message;
}

// 레거시 guard와 동일한 완전 명령만 부분 dispatch 후보로 올립니다.
export function isPetDuelEmoteCommandCandidate(message: string | undefined): boolean {
  return parsePetDuelEmoteCommand(message) !== null;
}

// 레거시의 70% 결과 추첨과 결과별 10개 문구 추첨을 재현합니다.
export function choosePetDuelEmote(random: () => number): { outcome: "success" | "failure"; outcomeRoll: number; phraseRoll: number; phraseIndex: number; phrase: string } {
  const outcomeRoll = random();
  const outcome = outcomeRoll < 0.7 ? "success" : "failure";
  const phrases = outcome === "success" ? SUCCESS_PHRASES : FAILURE_PHRASES;
  const phraseRoll = random();
  const phraseIndex = Math.min(phrases.length - 1, Math.max(0, Math.floor(phraseRoll * phrases.length)));
  return { outcome, outcomeRoll, phraseRoll, phraseIndex, phrase: phrases[phraseIndex]! };
}

function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | PetDuelEmoteResult): PetDuelEmoteResult {
  return typeof value === "string" ? JSON.parse(value) as PetDuelEmoteResult : value;
}

// 품행제로 장착·대상·난수 근거·응답을 한 트랜잭션에서 재시도 안전하게 처리합니다.
export class PetDuelEmoteService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetDuelEmoteResult> {
    const command = parsePetDuelEmoteCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_PET_DUEL_EMOTE_COMMAND", "사용법: /결투 [아이디]", 422);
    return this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<Array<{ identity_id: bigint; player_id: bigint; current_display_name: string; rank_emoji: string | null }>>(
        `SELECT identity.id identity_id,identity.player_id,profile.current_display_name,rank_profile.rank_emoji
           FROM external_identities identity JOIN players player ON player.id=identity.player_id
           JOIN player_profiles profile ON profile.player_id=player.id
           LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
            AND player.status='active' AND player.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [input.externalUserId],
      );
      const actor = actors[0];
      if (actor === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);
      const scope = `pet.duel-emote:${actor.identity_id}`;
      const key = normalizeEventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetDuelEmoteResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key],
      );
      if (prior[0]?.result_json != null) return parseStored(prior[0].result_json);

      let target: { player_id: bigint; current_display_name: string; rank_emoji: string | null } | null = null;
      if (command.kind === "duel") {
        const equipped = await transaction.query<Array<{ equipped: bigint }>>(
          `SELECT 1 equipped FROM player_pets pet JOIN pet_skills owned ON owned.player_pet_id=pet.id AND owned.equipped=TRUE
            JOIN skill_definitions definition ON definition.id=owned.skill_id AND definition.active=TRUE
           WHERE pet.player_id=? AND definition.display_name='품행제로' LIMIT 1`, [actor.player_id],
        );
        if (equipped.length === 0) throw new ApplicationError("PET_DUEL_SKILL_REQUIRED", "장착 중인 품행제로📙 스킬이 없습니다.", 409);
        const targets = await transaction.query<Array<{ player_id: bigint; current_display_name: string; rank_emoji: string | null }>>(
          `SELECT profile.player_id,profile.current_display_name,rank_profile.rank_emoji FROM player_profiles profile
            JOIN players player ON player.id=profile.player_id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=profile.player_id
           WHERE profile.current_display_name=? AND player.status='active' AND player.deleted_at IS NULL ORDER BY profile.player_id LIMIT 2 FOR UPDATE`, [command.targetName],
        );
        if (targets.length === 0) throw new ApplicationError("PET_DUEL_TARGET_NOT_FOUND", "❌ 존재하지 않는 유저입니다.", 404);
        if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 사용자가 여러 명입니다.", 409);
        target = targets[0]!;
        if (target.player_id === actor.player_id) throw new ApplicationError("PET_DUEL_SELF_TARGET", "자기 자신에게 결투를 걸 수는 없습니다.", 422);
      }

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, key, actor.identity_id],
      );
      let data: string;
      let outcome: PetDuelEmoteResult["outcome"] = null;
      if (command.kind === "usage") {
        data = "사용법: /결투 [아이디]";
      } else {
        const draw = choosePetDuelEmote(this.random);
        outcome = draw.outcome;
        const actorRank = `${actor.rank_emoji ?? ""}${actor.current_display_name}`;
        const targetRank = `${target!.rank_emoji ?? ""}${target!.current_display_name}`;
        data = `품행제로📙 \n🎯 대상: [${targetRank}]\n━━━━━━━━━━━━━━\n[${actorRank}] : ${draw.phrase}`;
        await transaction.execute(
          `INSERT INTO pet_duel_emote_events(operation_id,actor_player_id,target_player_id,outcome_code,outcome_roll,phrase_roll,phrase_index,created_at)
           VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
          [operation.insertId, actor.player_id, target!.player_id, draw.outcome, draw.outcomeRoll, draw.phraseRoll, draw.phraseIndex],
        );
      }
      const outboxId = await this.queue(transaction, operation.insertId, input.destinationId, data);
      const result: PetDuelEmoteResult = { status: command.kind === "usage" ? "usage" : "emote", outcome, actorPlayerId: actor.player_id.toString(), targetPlayerId: target?.player_id.toString() ?? null, reply: { outboxId: outboxId.toString(), room: input.destinationId, data } };
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_DUEL_EMOTE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId, result.status],
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'external_identity',?,'player',?,'pet.duel_emote','success',?,?,UTC_TIMESTAMP(3))`,
        [operation.insertId, actor.identity_id, target?.player_id ?? actor.player_id, `Iris ${input.message}`, JSON.stringify({ status: result.status, outcome, gameplayMutation: false })],
      );
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async queue(transaction: DatabaseTransaction, operationId: bigint, room: string, data: string): Promise<bigint> {
    return (await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, room, JSON.stringify({ data })])).insertId;
  }
}
