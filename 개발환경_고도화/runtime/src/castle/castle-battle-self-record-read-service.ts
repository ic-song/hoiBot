import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export const CASTLE_BATTLE_SELF_RECORD_COMMAND = "/캐슬전적";
type Numeric = bigint | number | string;

export interface CastleBattleSelfRecordSnapshot {
  playerId: string;
  displayName: string;
  petName: string;
  petImage: string;
  petExperience: number;
  effectiveUpgradeLevel: number;
  castleCharm: number;
  wins: bigint;
  losses: bigint;
  score: bigint;
  rankName: string;
  rankPosition: number | null;
  dailyAttempts: number;
}

export interface CastleBattleSelfRecordResult {
  status: "completed";
  data: string;
  outboxId: string;
  replayed: boolean;
}

interface RecordRow {
  player_id: Numeric;
  display_name: string;
  pet_name: string;
  pet_image: string | null;
  pet_experience: Numeric;
  pet_enhancement: Numeric;
  mini_castle: Numeric;
  home_castle: Numeric;
  intimacy_castle: Numeric;
  elemental_castle: Numeric;
  pendant_castle: Numeric;
  item_castle: Numeric;
  castle_percent: Numeric;
  upgrade_percent: Numeric;
  win_count: Numeric;
  loss_count: Numeric;
  score_value: Numeric;
  last_battle_at: Date | string | null;
  rank_position: Numeric | null;
  daily_attempts: Numeric;
}

// `/캐슬전적` 정확 일치 요청만 현대화 후보로 허용합니다.
export function isCastleBattleSelfRecordCommand(message: string | undefined): boolean {
  return message === CASTLE_BATTLE_SELF_RECORD_COMMAND;
}

// exact alias가 공용 dispatch에서 동일 command registry 행을 찾도록 유지합니다.
export function normalizeCastleBattleSelfRecordDispatchMessage(message: string): string {
  return isCastleBattleSelfRecordCommand(message) ? CASTLE_BATTLE_SELF_RECORD_COMMAND : message;
}

function integer(value: Numeric | null): number {
  return value === null ? 0 : Number(value);
}

function bigint(value: Numeric | null): bigint {
  return value === null ? 0n : BigInt(String(value).split(".")[0] ?? "0");
}

function commas(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

function parseStoredResult(value: string | CastleBattleSelfRecordResult): CastleBattleSelfRecordResult {
  return typeof value === "string" ? JSON.parse(value) as CastleBattleSelfRecordResult : value;
}

// 캐슬 전적 스냅샷을 승률·등급·CP·조건부 순위 순서로 표시합니다.
export function formatCastleBattleSelfRecord(snapshot: CastleBattleSelfRecordSnapshot): string {
  const total = snapshot.wins + snapshot.losses;
  const rate = total === 0n ? "0.00" : (Number(snapshot.wins * 10_000n / total) / 100).toFixed(2);
  const position = snapshot.rankPosition === null ? "미집계" : `${commas(snapshot.rankPosition)}위`;
  return [
    "🏆 캐슬대전 전적 🏆",
    `[${snapshot.displayName}]`,
    `펫: ${snapshot.petName}${snapshot.petImage === "" ? "" : `(${snapshot.petImage})`}`,
    `펫 매력: ${commas(snapshot.petExperience)}💕`,
    `캐슬매력: ${commas(snapshot.castleCharm)}💕`,
    `펫 강화: +${commas(snapshot.effectiveUpgradeLevel)}`,
    `전적: ${commas(snapshot.wins)}승 ${commas(snapshot.losses)}패 (승률 ${rate}%)`,
    `등급: ${snapshot.rankName}`,
    `CP: ${commas(snapshot.score)}🏆`,
    `순위: ${position}`,
    `오늘 대전: ${commas(snapshot.dailyAttempts)}회`
  ].join("\n");
}

// 회원·펫·아이템·홈·큐브·전적을 한 transaction의 일관 스냅샷으로 조회합니다.
export class CastleBattleSelfRecordReadService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<CastleBattleSelfRecordResult> {
    if (!isCastleBattleSelfRecordCommand(command.message)) {
      throw new ApplicationError("CASTLE_BATTLE_SELF_RECORD_COMMAND_INVALID", "정확한 /캐슬전적을 입력해 주세요.", 422);
    }
    return this.database.withTransaction(async (transaction) => {
      const identities = await transaction.query<Array<{ identity_id: Numeric; player_id: Numeric }>>(
        `SELECT identity.id AS identity_id,identity.player_id
         FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const identity = identities[0];
      if (identity === undefined) throw new ApplicationError("CASTLE_BATTLE_SELF_RECORD_IDENTITY_REQUIRED", "가입 후 이용할 수 있습니다.", 409);
      const scope = `castle.battle.self-record.read:${identity.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | CastleBattleSelfRecordResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        return { ...parseStoredResult(prior[0].result_json), replayed: true };
      }
      const seasons = await transaction.query<Array<{ id: Numeric }>>(
        `SELECT id FROM castle_battle_seasons WHERE status='active'
         AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))
         ORDER BY starts_at DESC,id DESC LIMIT 1 FOR UPDATE`
      );
      const season = seasons[0];
      if (season === undefined) throw new ApplicationError("CASTLE_BATTLE_SELF_RECORD_SEASON_REQUIRED", "현재 캐슬대전시즌이 아닙니다.", 409);
      const rows = await transaction.query<RecordRow[]>(
        `SELECT player.id AS player_id,profile.current_display_name AS display_name,
           pet.display_name AS pet_name,pet.image_value AS pet_image,pet.experience AS pet_experience,
           pet.enhancement_level AS pet_enhancement,COALESCE(mini.castle_experience,0) AS mini_castle,
           COALESCE(home.base_experience,0)+COALESCE((SELECT SUM(furniture_definition.charm_value)
             FROM furniture_placements placement JOIN owned_furniture furniture ON furniture.id=placement.owned_furniture_id
             JOIN furniture_definitions furniture_definition ON furniture_definition.id=furniture.furniture_definition_id
             WHERE placement.player_id=player.id),0) AS home_castle,
           COALESCE(intimacy.charm,0) AS intimacy_castle,COALESCE(elemental.castle_charm,0) AS elemental_castle,
           COALESCE(pendant.castle_charm,0) AS pendant_castle,
           COALESCE((SELECT SUM(stack.quantity*bonus.charm_per_unit) FROM inventory_stacks stack
             JOIN castle_battle_item_bonus_definitions bonus ON bonus.item_id=stack.item_id AND bonus.active=TRUE
             WHERE stack.player_id=player.id),0) AS item_castle,
           COALESCE(cube.castle_percent,0) AS castle_percent,COALESCE(cube.pet_upgrade_percent,0) AS upgrade_percent,
           COALESCE(state.win_count,0) AS win_count,COALESCE(state.loss_count,0) AS loss_count,
           COALESCE(state.score,0) AS score_value,state.last_battle_at,
           CASE WHEN state.last_battle_at IS NULL THEN NULL ELSE 1+(SELECT COUNT(*) FROM castle_battle_player_states ranked
             WHERE ranked.season_id=state.season_id AND ranked.last_battle_at IS NOT NULL
               AND (ranked.score>state.score OR (ranked.score=state.score AND ranked.last_battle_at>state.last_battle_at)
                 OR (ranked.score=state.score AND ranked.last_battle_at=state.last_battle_at AND ranked.player_id<state.player_id))) END AS rank_position,
           COALESCE(daily.castle_battle_attempts,0) AS daily_attempts
         FROM players player JOIN player_profiles profile ON profile.player_id=player.id
         JOIN player_pets pet ON pet.player_id=player.id
         LEFT JOIN castle_battle_player_states state ON state.player_id=player.id AND state.season_id=?
         LEFT JOIN player_pet_daily_records daily ON daily.player_id=player.id AND daily.record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))
         LEFT JOIN owned_mini_pets mini ON mini.player_id=player.id AND mini.equipped=TRUE
         LEFT JOIN player_homes home ON home.player_id=player.id
         LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id=pet.id
         LEFT JOIN player_pet_elementals elemental ON elemental.player_pet_id=pet.id
         LEFT JOIN player_pet_pendants pendant ON pendant.player_pet_id=pet.id
         LEFT JOIN player_home_badge_cubes cube ON cube.player_id=player.id AND cube.equipped=TRUE
         WHERE player.id=? FOR UPDATE`,
        [season.id, identity.player_id]
      );
      const row = rows[0];
      if (row === undefined) throw new ApplicationError("CASTLE_BATTLE_SELF_RECORD_PET_REQUIRED", "펫이 없습니다.", 409);
      const petExperience = integer(row.pet_experience);
      const baseCharm = petExperience+integer(row.mini_castle)+integer(row.home_castle)+integer(row.intimacy_castle)
        +integer(row.elemental_castle)+integer(row.pendant_castle)+integer(row.item_castle);
      const score = bigint(row.score_value);
      const rankRows = await transaction.query<Array<{ score_requirement: Numeric; rank_name: string }>>(
        "SELECT score_requirement,rank_name FROM castle_battle_rank_definitions ORDER BY score_requirement FOR UPDATE"
      );
      const rank = rankRows.filter((definition) => score >= bigint(definition.score_requirement)).at(-1)?.rank_name ?? "미배치";
      const snapshot: CastleBattleSelfRecordSnapshot = {
        playerId:String(row.player_id),displayName:row.display_name,petName:row.pet_name,petImage:row.pet_image ?? "",
        petExperience,effectiveUpgradeLevel:Math.round(integer(row.pet_enhancement)*(1+integer(row.upgrade_percent)/100)),
        castleCharm:Math.floor(baseCharm*(1+integer(row.castle_percent)/100)),wins:bigint(row.win_count),losses:bigint(row.loss_count),
        score,rankName:rank,rankPosition:row.rank_position === null ? null : integer(row.rank_position),dailyAttempts:integer(row.daily_attempts)
      };
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'player', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(),scope,eventKey,snapshot.playerId]
      );
      const data = formatCastleBattleSelfRecord(snapshot);
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId,command.channelId,JSON.stringify({data})]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'castle_battle_self_record_read',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [command.eventId,operation.insertId]
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'player',?,'player',?,'castle-battle.self-record.read','success','Iris 캐슬대전 자기 전적 조회',?,UTC_TIMESTAMP(3))`,
        [operation.insertId,snapshot.playerId,snapshot.playerId,JSON.stringify({score:score.toString(),rankName:rank,rankPosition:snapshot.rankPosition})]
      );
      const result: CastleBattleSelfRecordResult = {status:"completed",data,outboxId:outbox.insertId.toString(),replayed:false};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
