import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface SocialBoardPost {
  postId: string;
  authorName: string;
  rankEmoji: string;
  content: string;
  createdAt: string;
}

export interface SocialBoardReadResult {
  data: string;
  outboxId: string;
  postCount: number;
  firstPostId: string | null;
  lastPostId: string | null;
}

const boardHeader = "📋 전체 서버 게시판\n━━━━━━━━━━━━";

// 인자가 없는 정확한 전체 서버 게시판 조회 명령만 후보로 허용합니다.
export function isSocialBoardReadCommand(message: string | undefined): boolean {
  return message === "/게시판";
}

// 레거시 memo 순서에 대응하는 게시 시각·stable ID 순서로 게시글을 표시합니다.
export function formatSocialBoard(posts: readonly SocialBoardPost[]): string {
  if (posts.length === 0) return boardHeader;
  return `${boardHeader}\n${posts.map((post) =>
    `[${post.rankEmoji}${post.authorName}] ${post.content}\n${post.createdAt}`
  ).join("\n\n")}`;
}

// 검증된 회원의 전체 서버 게시판 조회를 일관 snapshot과 감사·outbox로 기록합니다.
export class SocialBoardReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<SocialBoardReadResult | null> {
    const viewer = (await this.database.query<Array<{ identity_id: bigint; player_id: bigint }>>(
      `SELECT identity.id identity_id,identity.player_id
         FROM external_identities identity
         JOIN players player ON player.id=identity.player_id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=?
          AND identity.status='linked' AND player.status='active' AND player.deleted_at IS NULL
        LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (viewer === undefined || viewer.player_id === null) return null;
    const idempotencyKey = input.eventId.length <= 191
      ? input.eventId
      : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const previous = (await transaction.query<Array<{ result_json: string | SocialBoardReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='social.board.read' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (previous?.result_json != null) {
        return typeof previous.result_json === "string" ? JSON.parse(previous.result_json) : previous.result_json;
      }
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'social.board.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey, viewer.identity_id]
      );
      const rows = await transaction.query<Array<{
        post_id: bigint;
        player_status: string | null;
        display_name: string | null;
        rank_emoji: string | null;
        body: string;
        created_at: string;
      }>>(
        `SELECT post.id post_id,player.status player_status,profile.current_display_name display_name,
                rank_profile.rank_emoji,post.body,
                DATE_FORMAT(post.created_at,'%Y-%m-%d %H:%i') created_at
           FROM community_boards board
           JOIN community_posts post ON post.board_id=board.id
           LEFT JOIN players player ON player.id=post.author_player_id
           LEFT JOIN player_profiles profile ON profile.player_id=player.id
           LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE board.code='legacy_public_board' AND board.active=TRUE
            AND post.status='published' AND post.deleted_at IS NULL
            AND (post.expires_at IS NULL OR post.expires_at>UTC_TIMESTAMP(3))
          ORDER BY post.created_at ASC,post.id ASC`
      );
      const posts: SocialBoardPost[] = rows.map((row) => ({
        postId: row.post_id.toString(),
        authorName: row.player_status === "active" && row.display_name !== null ? row.display_name : "탈퇴회원",
        rankEmoji: row.player_status === "active" ? row.rank_emoji ?? "" : "",
        content: row.body,
        createdAt: row.created_at
      }));
      const data = formatSocialBoard(posts);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'SOCIAL_BOARD_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]
      );
      const summary = {
        readOnly: true,
        postCount: posts.length,
        firstPostId: posts[0]?.postId ?? null,
        lastPostId: posts.at(-1)?.postId ?? null
      };
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'community_board',NULL,'social.board.read','success','Iris /게시판',?,UTC_TIMESTAMP(3))",
        [operation.insertId, viewer.identity_id, JSON.stringify(summary)]
      );
      const result: SocialBoardReadResult = {
        data,
        outboxId: outbox.insertId.toString(),
        postCount: posts.length,
        firstPostId: posts[0]?.postId ?? null,
        lastPostId: posts.at(-1)?.postId ?? null
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    }));
  }
}

// 동시 read event의 operations gap lock 교차로 생기는 MariaDB deadlock만 제한 재시도합니다.
async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const databaseError = error as { code?: unknown; errno?: unknown };
      if (attempt === 2 || (databaseError.code !== "ER_LOCK_DEADLOCK" && databaseError.errno !== 1213)) throw error;
    }
  }
  throw new Error("Social board read deadlock retry exhausted.");
}
