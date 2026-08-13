import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseDecimal3, formatDecimal3 } from "../shared/numeric-policy.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

interface EventCommandBase { playerId: string; seasonCode: string; modeCode: string; reason: string; idempotencyKey: string; actor: OperationActor; sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system"; }

// 이벤트 진행·불변 결과와 재생성 가능한 랭킹 projection을 관리합니다.
export class EventRankingService {
  private readonly operations: TransactionalOperationRunner;
  constructor(database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

  async recordProgress(command: EventCommandBase & { progress: Record<string, unknown>; expectedVersion: string }): Promise<{ version: string; auditId: string }> {
    return this.operations.run({ scope: `event.progress:${command.seasonCode}:${command.modeCode}:${command.playerId}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "event.progress.record", targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "event.progress.changed" }, async (transaction) => {
      const ids = await this.requireActiveEvent(transaction, command.seasonCode, command.modeCode);
      await transaction.execute("INSERT IGNORE INTO player_event_progress (season_id, mode_id, player_id, progress_json, version) VALUES (?, ?, ?, '{}', 0)", [ids.seasonId, ids.modeId, command.playerId]);
      const rows = await transaction.query<Array<{ version: bigint }>>("SELECT version FROM player_event_progress WHERE season_id = ? AND mode_id = ? AND player_id = ? FOR UPDATE", [ids.seasonId, ids.modeId, command.playerId]);
      const current = rows[0]!; if (current.version.toString() !== command.expectedVersion) throw new ApplicationError("EVENT_VERSION_CONFLICT", "이벤트 진행 정보가 먼저 변경되었습니다.", 409);
      const version = current.version + 1n;
      await transaction.execute("UPDATE player_event_progress SET progress_json = ?, version = ?, updated_at = UTC_TIMESTAMP(3) WHERE season_id = ? AND mode_id = ? AND player_id = ? AND version = ?", [JSON.stringify(command.progress), version, ids.seasonId, ids.modeId, command.playerId, current.version]);
      return { result: { version: version.toString() }, changeSummary: { seasonCode: command.seasonCode, modeCode: command.modeCode, version: version.toString() } };
    });
  }

  async submitResult(command: EventCommandBase & { score: string; result: Record<string, unknown> }): Promise<{ resultId: string; score: string; auditId: string }> {
    const score = parseDecimal3(command.score, "score");
    return this.operations.run({ scope: `event.result:${command.seasonCode}:${command.modeCode}:${command.playerId}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "event.result.submit", targetType: "player", targetId: command.playerId,
      reason: command.reason, outboxType: "event.result.submitted" }, async (transaction, operationId) => {
      const ids = await this.requireActiveEvent(transaction, command.seasonCode, command.modeCode);
      const inserted = await transaction.execute("INSERT INTO event_results (operation_id, season_id, mode_id, player_id, score, result_json) VALUES (?, ?, ?, ?, ?, ?)", [operationId, ids.seasonId, ids.modeId, command.playerId, formatDecimal3(score), JSON.stringify(command.result)]);
      return { result: { resultId: inserted.insertId.toString(), score: formatDecimal3(score) }, changeSummary: { seasonCode: command.seasonCode, modeCode: command.modeCode, score: formatDecimal3(score) } };
    });
  }

  async rebuildLeaderboard(command: Omit<EventCommandBase, "playerId"> & { leaderboardCode: string }): Promise<{ entryCount: string; auditId: string }> {
    return this.operations.run({ scope: `leaderboard.rebuild:${command.leaderboardCode}:${command.seasonCode}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "leaderboard.rebuild", targetType: "leaderboard", reason: command.reason,
      outboxType: "leaderboard.rebuilt" }, async (transaction) => {
      const ids = await this.requireEvent(transaction, command.seasonCode, command.modeCode);
      await transaction.execute(`INSERT INTO leaderboards (code, season_key, calculated_at) VALUES (?, ?, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE calculated_at = VALUES(calculated_at)`, [command.leaderboardCode, command.seasonCode]);
      const boards = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM leaderboards WHERE code = ? AND season_key = ? FOR UPDATE", [command.leaderboardCode, command.seasonCode]);
      const leaderboardId = boards[0]!.id;
      const scores = await transaction.query<Array<{ player_id: bigint; score: string; current_display_name: string }>>(
        `SELECT er.player_id, MAX(er.score) AS score, pp.current_display_name
         FROM event_results er JOIN player_profiles pp ON pp.player_id = er.player_id
         WHERE er.season_id = ? AND er.mode_id = ?
         GROUP BY er.player_id, pp.current_display_name
         ORDER BY MAX(er.score) DESC, pp.current_display_name COLLATE utf8mb4_unicode_ci ASC, er.player_id ASC`,
        [ids.seasonId, ids.modeId]
      );
      await transaction.execute("DELETE FROM leaderboard_entries WHERE leaderboard_id = ?", [leaderboardId]);
      for (let index = 0; index < scores.length; index += 1) {
        const row = scores[index]!;
        await transaction.execute("INSERT INTO leaderboard_entries (leaderboard_id, player_id, rank_no, score, tie_break_key) VALUES (?, ?, ?, ?, ?)", [leaderboardId, row.player_id, index + 1, row.score, row.current_display_name]);
      }
      return { result: { entryCount: scores.length.toString() }, changeSummary: { leaderboardCode: command.leaderboardCode, seasonCode: command.seasonCode, entryCount: scores.length } };
    });
  }

  private async requireEvent(transaction: import("../database.js").DatabaseTransaction, seasonCode: string, modeCode: string): Promise<{ seasonId: bigint; modeId: bigint }> {
    const rows = await transaction.query<Array<{ season_id: bigint; mode_id: bigint }>>(`SELECT season.id AS season_id, mode.id AS mode_id
      FROM event_seasons season JOIN game_mode_definitions mode ON mode.code = ? AND mode.active = TRUE WHERE season.code = ?`, [modeCode, seasonCode]);
    if (rows[0] === undefined) throw new ApplicationError("EVENT_NOT_FOUND", "이벤트 시즌 또는 모드를 찾을 수 없습니다.", 404);
    return { seasonId: rows[0].season_id, modeId: rows[0].mode_id };
  }

  private async requireActiveEvent(transaction: import("../database.js").DatabaseTransaction, seasonCode: string, modeCode: string): Promise<{ seasonId: bigint; modeId: bigint }> {
    const rows = await transaction.query<Array<{ season_id: bigint; mode_id: bigint }>>(`SELECT season.id AS season_id, mode.id AS mode_id
      FROM event_seasons season JOIN game_mode_definitions mode ON mode.code = ? AND mode.active = TRUE
      WHERE season.code = ? AND season.status = 'active' AND UTC_TIMESTAMP(3) BETWEEN season.starts_at AND season.ends_at`, [modeCode, seasonCode]);
    if (rows[0] === undefined) throw new ApplicationError("EVENT_NOT_ACTIVE", "현재 진행 중인 이벤트가 아닙니다.", 409);
    return { seasonId: rows[0].season_id, modeId: rows[0].mode_id };
  }
}
