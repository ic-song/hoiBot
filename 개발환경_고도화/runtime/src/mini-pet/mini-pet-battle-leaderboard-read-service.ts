import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export const MINI_PET_BATTLE_RANKING_COMMAND = "/미니펫대전순위";
export const MINI_PET_BATTLE_WIN_RATE_COMMAND = "/미니펫대전승률";
const ALL_SEE = "​".repeat(500);
type Numeric = bigint | number | string;
export type MiniPetLeaderboardMode = "wins" | "rate";

export interface MiniPetLeaderboardRow {
  playerId: string;
  displayName: string;
  miniPetName: string | null;
  wins: bigint;
  losses: bigint;
  roundedWinRate: number;
}

export interface MiniPetLeaderboardResult {
  status: "completed";
  mode: MiniPetLeaderboardMode;
  data: string;
  snapshotId: string;
  outboxId: string;
  replayed: boolean;
}

interface SourceRow {
  player_id: Numeric;
  display_name: string;
  mini_pet_name: string | null;
  win_count: Numeric;
  loss_count: Numeric;
  state_version: Numeric;
}

// 두 exact 레거시 leaderboard 명령만 현대화 후보로 허용합니다.
export function isMiniPetBattleLeaderboardCommand(message: string | undefined): boolean {
  return message === MINI_PET_BATTLE_RANKING_COMMAND || message === MINI_PET_BATTLE_WIN_RATE_COMMAND;
}

// exact alias가 공용 registry의 개별 command code를 유지하도록 입력을 그대로 둡니다.
export function normalizeMiniPetBattleLeaderboardDispatchMessage(message: string): string {
  return isMiniPetBattleLeaderboardCommand(message) ? message : message;
}

export function miniPetLeaderboardMode(message: string): MiniPetLeaderboardMode {
  if (message === MINI_PET_BATTLE_RANKING_COMMAND) return "wins";
  if (message === MINI_PET_BATTLE_WIN_RATE_COMMAND) return "rate";
  throw new ApplicationError("MINI_PET_LEADERBOARD_COMMAND_INVALID", "정확한 /미니펫대전순위 또는 /미니펫대전승률을 입력해 주세요.", 422);
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function count(value: Numeric): bigint {
  const parsed = BigInt(String(value).split(".")[0] ?? "0");
  return parsed < 0n ? 0n : parsed;
}

function roundedRate(wins: bigint, losses: bigint): number {
  const total = wins + losses;
  return total === 0n ? 0 : Number((wins * 100n + total / 2n) / total);
}

function commas(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 50승 또는 50판 기준을 적용한 뒤 레거시 tie chain으로 순차 등수를 확정합니다.
export function buildMiniPetLeaderboard(rows: readonly MiniPetLeaderboardRow[], mode: MiniPetLeaderboardMode): MiniPetLeaderboardRow[] {
  const eligible = rows.filter((row) => mode === "wins" ? row.wins >= 50n : row.wins + row.losses >= 50n);
  return [...eligible].sort((left, right) => {
    if (mode === "rate" && left.roundedWinRate !== right.roundedWinRate) return right.roundedWinRate - left.roundedWinRate;
    if (left.wins !== right.wins) return left.wins > right.wins ? -1 : 1;
    if (left.losses !== right.losses) return left.losses < right.losses ? -1 : 1;
    return left.displayName.localeCompare(right.displayName, "ko");
  });
}

// 순차 등수와 11번째 allsee 경계를 고정된 snapshot 순서로 표시합니다.
export function formatMiniPetLeaderboard(mode: MiniPetLeaderboardMode, rows: readonly MiniPetLeaderboardRow[]): string {
  const title = mode === "wins" ? "🐹 미니펫대전 순위 🐹" : "🐹 미니펫대전 승률 순위 🐹";
  if (rows.length === 0) return `${title}\n\n조건을 충족한 회원이 없습니다.`;
  const lines = [title, ""];
  rows.forEach((row, index) => {
    if (index === 10) lines.push(ALL_SEE);
    lines.push(`${index + 1}위. ${row.displayName} | ${commas(row.wins)}승 ${commas(row.losses)}패 | 승률 ${row.roundedWinRate}%`);
  });
  return lines.join("\n");
}

function stored(value: string | MiniPetLeaderboardResult): MiniPetLeaderboardResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetLeaderboardResult : value;
}

// 활성 회원 승패와 표시명을 한 transaction에 고정하고 immutable leaderboard snapshot을 기록합니다.
export class MiniPetBattleLeaderboardReadService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<MiniPetLeaderboardResult> {
    const mode = miniPetLeaderboardMode(command.message);
    return this.database.withTransaction(async (transaction) => {
      const identity = (await transaction.query<Array<{ identity_id: Numeric; player_id: Numeric }>>(
        `SELECT identity.id AS identity_id,identity.player_id FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.status='active'
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`, [command.externalUserId]
      ))[0];
      if (identity === undefined) throw new ApplicationError("MINI_PET_LEADERBOARD_IDENTITY_REQUIRED", "가입 후 이용할 수 있습니다.", 409);
      const scope = `mini-pet.battle.leaderboard.read:${identity.identity_id}:${mode}`;
      const key = eventKey(command.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | MiniPetLeaderboardResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]
      ))[0];
      if (prior?.result_json !== null && prior?.result_json !== undefined) return { ...stored(prior.result_json), replayed:true };

      const sourceRows = await transaction.query<SourceRow[]>(
        `SELECT player.id AS player_id,profile.current_display_name AS display_name,
           COALESCE(equipped.custom_name,definition.display_name) AS mini_pet_name,
           COALESCE(state.win_count,0) AS win_count,COALESCE(state.loss_count,0) AS loss_count,
           COALESCE(state.version,0) AS state_version
         FROM players player JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN mini_pet_battle_states state ON state.player_id=player.id
         LEFT JOIN owned_mini_pets equipped ON equipped.player_id=player.id AND equipped.equipped=TRUE
           AND equipped.id=(SELECT MIN(candidate.id) FROM owned_mini_pets candidate WHERE candidate.player_id=player.id AND candidate.equipped=TRUE)
         LEFT JOIN mini_pet_definitions definition ON definition.id=equipped.mini_pet_definition_id
         WHERE player.status='active' ORDER BY player.id FOR UPDATE`
      );
      const source = sourceRows.map((row) => {
        const wins=count(row.win_count),losses=count(row.loss_count);
        return {playerId:String(row.player_id),displayName:row.display_name,miniPetName:row.mini_pet_name,
          wins,losses,roundedWinRate:roundedRate(wins,losses)} satisfies MiniPetLeaderboardRow;
      });
      const ranked = buildMiniPetLeaderboard(source, mode);
      const sourceVersion = createHash("sha256").update(sourceRows.map((row) =>
        `${row.player_id}:${row.win_count}:${row.loss_count}:${row.state_version}:${row.display_name}`).join("|")).digest("hex");
      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(),scope,key,String(identity.identity_id)]
      );
      const snapshot = await transaction.execute(
        "INSERT INTO mini_pet_battle_leaderboard_snapshots(operation_id,ranking_mode,source_version,eligible_count) VALUES (?,?,?,?)",
        [operation.insertId,mode,sourceVersion,ranked.length]
      );
      for (let index=0; index<ranked.length; index+=1) {
        const row=ranked[index]!;
        await transaction.execute(
          "INSERT INTO mini_pet_battle_leaderboard_entries(snapshot_id,ordinal_value,player_id,display_name,mini_pet_name,win_count,loss_count,rounded_win_rate) VALUES (?,?,?,?,?,?,?,?)",
          [snapshot.insertId,index+1,row.playerId,row.displayName,row.miniPetName,row.wins.toString(),row.losses.toString(),row.roundedWinRate]
        );
      }
      const data = formatMiniPetLeaderboard(mode, ranked);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId,command.channelId,JSON.stringify({data})]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'mini_pet_battle_leaderboard_read',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [command.eventId,operation.insertId]
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'mini_pet_leaderboard_snapshot',?,'mini_pet.battle.leaderboard.read','success','Iris 미니펫 대전 leaderboard 조회',?,UTC_TIMESTAMP(3))",
        [operation.insertId,String(identity.identity_id),snapshot.insertId,JSON.stringify({mode,sourceVersion,eligibleCount:ranked.length})]
      );
      const result: MiniPetLeaderboardResult = {status:"completed",mode,data,snapshotId:snapshot.insertId.toString(),outboxId:outbox.insertId.toString(),replayed:false};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
