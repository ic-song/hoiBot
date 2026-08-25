import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type {
  CastleBattleRankingCommand,
  CastleBattleRankingRepository,
  CastleBattleRankingResult,
  CastleBattleRankingSnapshot
} from "./castle-battle-ranking-repository.js";

// 긴 Iris 이벤트 키를 operations 고유키 제한에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 응답 계약으로 복원합니다.
function parseResult(value: string | CastleBattleRankingResult): CastleBattleRankingResult {
  return typeof value === "string" ? JSON.parse(value) as CastleBattleRankingResult : value;
}

// 캐슬대전 순위 읽기·감사·outbox를 하나의 MariaDB 트랜잭션으로 처리합니다.
export class MariaCastleBattleRankingRepository implements CastleBattleRankingRepository {
  constructor(private readonly database: DatabaseClient) {}

  async read(
    command: CastleBattleRankingCommand,
    render: (snapshot: CastleBattleRankingSnapshot | null) => string
  ): Promise<CastleBattleRankingResult> {
    return this.database.withTransaction(async (transaction) => {
      const playerId = await this.findPlayer(transaction, command.externalUserId);
      const scope = `castle-battle-ranking:${playerId}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | CastleBattleRankingResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json != null) return parseResult(prior[0].result_json);

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'player', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, playerId]
      );
      const snapshot = await this.readPublishedSnapshot(transaction);
      const data = render(snapshot);
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'castle_battle_ranking_read',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'player',?,'castle_battle_season',NULL,'castle-battle.ranking.read','success','Iris 캐슬대전 순위 조회',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, playerId, JSON.stringify({ seasonKey: snapshot?.seasonKey ?? null, snapshotVersion: snapshot?.snapshotVersion ?? null, sourceVersion: snapshot?.sourceVersion ?? null })]
      );
      const result: CastleBattleRankingResult = {
        status: "completed",
        data,
        seasonKey: snapshot?.seasonKey ?? null,
        snapshotVersion: snapshot?.snapshotVersion ?? null,
        outboxId: outbox.insertId.toString()
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }

  // 연결된 활성 사용자를 조회해 미가입 요청을 차단합니다.
  private async findPlayer(transaction: DatabaseTransaction, externalUserId: string): Promise<string> {
    const rows = await transaction.query<Array<{ player_id: bigint }>>(
      `SELECT identity.player_id FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=?
         AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
      [externalUserId]
    );
    if (rows[0] === undefined) {
      throw new ApplicationError("IDENTITY_MAPPING_REQUIRED", "가입 후 이용할 수 있습니다.", 404);
    }
    return rows[0].player_id.toString();
  }

  // 활성 시즌의 마지막 게시 스냅샷을 결정적 tie 순서로 읽습니다.
  private async readPublishedSnapshot(transaction: DatabaseTransaction): Promise<CastleBattleRankingSnapshot | null> {
    const snapshots = await transaction.query<Array<{ id: bigint; season_key: string; source_version: string; snapshot_version: bigint }>>(
      `SELECT snapshot.id,season.season_key,snapshot.source_version,snapshot.snapshot_version
       FROM castle_battle_seasons season
       JOIN castle_battle_rank_snapshots snapshot ON snapshot.season_id=season.id
       WHERE season.status='active' AND snapshot.status='published' AND snapshot.published_at IS NOT NULL
       ORDER BY season.starts_at DESC,snapshot.snapshot_version DESC,snapshot.id DESC LIMIT 1 FOR UPDATE`
    );
    const snapshot = snapshots[0];
    if (snapshot === undefined) return null;
    const entries = await transaction.query<Array<{ rank_display: number; tier_display: string; display_name: string; score: bigint }>>(
      `SELECT rank_display,tier_display,display_name,score
       FROM castle_battle_rank_snapshot_entries WHERE snapshot_id=?
       ORDER BY score DESC,last_battle_at DESC,stable_tie_key ASC`,
      [snapshot.id]
    );
    return {
      seasonKey: snapshot.season_key,
      sourceVersion: snapshot.source_version,
      snapshotVersion: snapshot.snapshot_version.toString(),
      entries: entries.map((entry) => ({ rank: entry.rank_display, tier: entry.tier_display, displayName: entry.display_name, score: entry.score }))
    };
  }
}
