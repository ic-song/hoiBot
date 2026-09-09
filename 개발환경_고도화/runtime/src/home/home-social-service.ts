import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

interface HomeCommandBase { homePlayerId: string; actorPlayerId: string; reason: string; idempotencyKey: string; actor: OperationActor; sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system"; }

// 홈 방문·댓글·반응과 소유자 활동 기록을 같은 트랜잭션으로 남깁니다.
export class HomeSocialService {
  private readonly operations: TransactionalOperationRunner;
  constructor(database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

  async visit(command: HomeCommandBase): Promise<{ visitId: string; auditId: string }> {
    return this.operations.run({ scope: `home.visit:${command.homePlayerId}:${command.actorPlayerId}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "home.visit", targetType: "player", targetId: command.homePlayerId,
      reason: command.reason, outboxType: "home.visited" }, async (transaction, operationId) => {
      await this.requireHome(transaction, command.homePlayerId);
      const visit = await transaction.execute("INSERT INTO home_visits (home_player_id, visitor_player_id) VALUES (?, ?)", [command.homePlayerId, command.actorPlayerId]);
      await transaction.execute("UPDATE player_homes SET visit_count=visit_count+1,version=version+1 WHERE player_id=?", [command.homePlayerId]);
      await transaction.execute("INSERT INTO home_activity_events (operation_id, home_player_id, actor_player_id, activity_code, reference_id) VALUES (?, ?, ?, 'visit', ?)", [operationId, command.homePlayerId, command.actorPlayerId, visit.insertId]);
      return { result: { visitId: visit.insertId.toString() }, changeSummary: { visitorPlayerId: command.actorPlayerId } };
    });
  }

  async comment(command: HomeCommandBase & { body: string }): Promise<{ commentId: string; auditId: string }> {
    const body = command.body.trim(); if (body === "" || body.length > 1000) throw new ApplicationError("INVALID_HOME_COMMENT", "댓글은 1~1000자여야 합니다.", 422);
    return this.operations.run({ scope: `home.comment:${command.homePlayerId}:${command.actorPlayerId}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "home.comment", targetType: "player", targetId: command.homePlayerId,
      reason: command.reason, outboxType: "home.commented" }, async (transaction, operationId) => {
      await this.requireHome(transaction, command.homePlayerId);
      const comment = await transaction.execute("INSERT INTO home_comments (home_player_id, author_player_id, body) VALUES (?, ?, ?)", [command.homePlayerId, command.actorPlayerId, body]);
      await transaction.execute("INSERT INTO home_activity_events (operation_id, home_player_id, actor_player_id, activity_code, reference_id) VALUES (?, ?, ?, 'comment', ?)", [operationId, command.homePlayerId, command.actorPlayerId, comment.insertId]);
      return { result: { commentId: comment.insertId.toString() }, changeSummary: { commentId: comment.insertId.toString() } };
    });
  }

  async react(command: HomeCommandBase & { reactionCode: string }): Promise<{ created: boolean; likeCount: string; auditId: string }> {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(command.reactionCode)) throw new ApplicationError("INVALID_REACTION", "반응 코드는 영문 소문자 코드여야 합니다.", 422);
    return this.operations.run({ scope: `home.react:${command.homePlayerId}:${command.actorPlayerId}:${command.reactionCode}`, idempotencyKey: command.idempotencyKey,
      actor: command.actor, sourceCode: command.sourceCode, actionCode: "home.react", targetType: "player", targetId: command.homePlayerId,
      reason: command.reason, outboxType: "home.reacted" }, async (transaction, operationId) => {
      const home = await transaction.query<Array<{ like_count: bigint; version: bigint }>>("SELECT like_count, version FROM player_homes WHERE player_id = ? FOR UPDATE", [command.homePlayerId]);
      if (home[0] === undefined) throw new ApplicationError("HOME_NOT_FOUND", "회원의 홈을 찾을 수 없습니다.", 404);
      const inserted = await transaction.execute("INSERT IGNORE INTO home_reactions (home_player_id, actor_player_id, reaction_code) VALUES (?, ?, ?)", [command.homePlayerId, command.actorPlayerId, command.reactionCode]);
      const created = inserted.affectedRows === 1n; const increment = created && command.reactionCode === "like" ? 1n : 0n;
      const likeCount = home[0].like_count + increment;
      if (increment === 1n) await transaction.execute("UPDATE player_homes SET like_count = ?, version = version + 1 WHERE player_id = ? AND version = ?", [likeCount, command.homePlayerId, home[0].version]);
      await transaction.execute("INSERT INTO home_activity_events (operation_id, home_player_id, actor_player_id, activity_code, detail_json) VALUES (?, ?, ?, 'reaction', ?)", [operationId, command.homePlayerId, command.actorPlayerId, JSON.stringify({ reactionCode: command.reactionCode, created })]);
      return { result: { created, likeCount: likeCount.toString() }, changeSummary: { reactionCode: command.reactionCode, created, likeCount: likeCount.toString() } };
    });
  }

  private async requireHome(transaction: import("../database.js").DatabaseTransaction, playerId: string): Promise<void> {
    const rows = await transaction.query<Array<{ player_id: bigint }>>("SELECT player_id FROM player_homes WHERE player_id = ?", [playerId]);
    if (rows[0] === undefined) throw new ApplicationError("HOME_NOT_FOUND", "회원의 홈을 찾을 수 없습니다.", 404);
  }
}
