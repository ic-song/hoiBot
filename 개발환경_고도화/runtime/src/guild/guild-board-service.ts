import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export type GuildBoardCommand =
  | { kind: "READ" }
  | { kind: "POST"; body: string }
  | { kind: "NOTICE"; body: string }
  | { kind: "CLEAR" };

interface OwnerRow { identity_id: bigint; player_id: bigint; display_name: string; ranked_name: string; }
interface GuildMemberRow { guild_id: bigint; guild_name: string; guild_version: bigint; role_code: string; }
export interface GuildBoardNotice { body: string; writer: string; date: string; }
export interface GuildBoardPost { postId: string; body: string; writer: string; date: string; }
export interface GuildBoardResult {
  status: "read" | "posted" | "notice_changed" | "cleared";
  replayed: boolean;
  guildId: string;
  guildVersion: string;
  data: string;
  postId?: string;
  trimmedCount?: number;
  clearedCount?: number;
  outboxId: string;
  auditId: string;
}

const COMMAND_CODE = "GUILD_BOARD_READ_WRITE";
const LEADER_ROLES = ["leader", "master", "sub_master", "submaster"];

// 길드 게시판 5개 명령의 exact/prefix namespace만 공용 dispatch 후보로 분류합니다.
export function isGuildBoardCommandCandidate(message: string | undefined): boolean {
  if (message === undefined) return false;
  return message === "/길메" || message === "/길드게시판" || message === "/길드게시판초기화"
    || message.startsWith("/길메 ") || message.startsWith("/길드게시판 ") || message.startsWith("/길드게시판공지 ");
}

// 조회·등록·공지·초기화 입력을 레거시 30자 경계와 함께 해석합니다.
export function parseGuildBoardCommand(message: string): GuildBoardCommand {
  if (message === "/길메" || message === "/길드게시판") return { kind: "READ" };
  if (message === "/길드게시판초기화") return { kind: "CLEAR" };
  const post = /^(?:\/길메|\/길드게시판) (.*)$/.exec(message);
  const notice = /^\/길드게시판공지 (.*)$/.exec(message);
  if (post !== null) return { kind: "POST", body: parseBody(post[1] ?? "", "사용법: /길메 내용 또는 /길드게시판 내용") };
  if (notice !== null) return { kind: "NOTICE", body: parseBody(notice[1] ?? "", "사용법: /길드게시판공지 내용") };
  throw new ApplicationError("GUILD_BOARD_COMMAND_INVALID", "길드 게시판 명령 형식을 확인해 주세요.", 422);
}

// 인자형 명령을 registry에 등록된 대표 별칭으로 정규화합니다.
export function normalizeGuildBoardDispatchMessage(message: string): string {
  const command = parseGuildBoardCommand(message);
  if (command.kind === "NOTICE") return "/길드게시판공지";
  if (command.kind === "CLEAR") return "/길드게시판초기화";
  return message.startsWith("/길메") ? "/길메" : "/길드게시판";
}

// 공지 우선, 게시글 최신순의 길드 게시판 표시 문자열을 만듭니다.
export function formatGuildBoard(input: { guildName: string; notice?: GuildBoardNotice; posts: readonly GuildBoardPost[] }): string {
  let output = `🎖️ ${input.guildName} 길드 게시판 🎖️\n\n`;
  if (input.notice !== undefined) output += `길드게시판 공지📢:\n${input.notice.body} (${input.notice.date})\n\n`;
  if (input.posts.length === 0) return `${output}등록된 게시글이 없습니다.`;
  for (const post of input.posts) output += `[${post.writer}] : ${post.body} (${post.date})\n`;
  return output.trim();
}

function parseBody(value: string, usage: string): string {
  const body = value.trim();
  if (body.length === 0) throw new ApplicationError("GUILD_BOARD_BODY_REQUIRED", usage, 422);
  return body;
}

// 레거시 랭크 표기를 포함한 게시글·공지 30자 초과 응답을 보존합니다.
export function requireGuildBoardBodyLimit(command: GuildBoardCommand, rankedName: string): void {
  if ((command.kind === "POST" || command.kind === "NOTICE") && command.body.length > 30) {
    const target = command.kind === "POST" ? "게시글" : "공지";
    throw new ApplicationError("GUILD_BOARD_BODY_TOO_LONG", `❌ [${rankedName}] 님 ${target}은 30자 이내로 입력해주세요.`, 422);
  }
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | GuildBoardResult): GuildBoardResult { return typeof value === "string" ? JSON.parse(value) as GuildBoardResult : value; }
function requireLeader(roleCode: string, rankedName: string, command: "NOTICE" | "CLEAR"): void {
  if (!LEADER_ROLES.includes(roleCode.toLowerCase())) {
    const action = command === "NOTICE" ? "공지를 설정" : "게시판을 초기화";
    throw new ApplicationError("GUILD_BOARD_LEADER_REQUIRED", `❌ [${rankedName}] 님 길드마스터만 ${action}할 수 있습니다.`, 403);
  }
}

// 공지와 최신 20개 게시글을 동일 transaction snapshot으로 조회합니다.
async function readBoard(transaction: DatabaseTransaction, guild: GuildMemberRow): Promise<{ notice?: GuildBoardNotice; posts: GuildBoardPost[]; data: string }> {
  const notices = await transaction.query<Array<{ body: string; writer: string; written_on: string }>>(
    `SELECT notice.body,notice.author_display_name_snapshot writer,
      DATE_FORMAT(DATE_ADD(notice.updated_at,INTERVAL 9 HOUR),'%m/%d %H:%i') written_on
     FROM guild_board_notices notice WHERE notice.guild_id=?`, [guild.guild_id]);
  const rows = await transaction.query<Array<{ id: bigint; body: string; writer: string; written_on: string }>>(
    `SELECT post.id,post.body,COALESCE(post.author_display_name_snapshot,profile.current_display_name) writer,
      DATE_FORMAT(DATE_ADD(post.created_at,INTERVAL 9 HOUR),'%m/%d %H:%i') written_on
     FROM guild_board_posts post JOIN player_profiles profile ON profile.player_id=post.author_player_id
     WHERE post.guild_id=? AND post.status='published' AND post.deleted_at IS NULL
     ORDER BY post.created_at DESC,post.id DESC LIMIT 20`, [guild.guild_id]);
  const notice = notices[0] === undefined ? undefined : { body: notices[0].body, writer: notices[0].writer, date: notices[0].written_on };
  const posts = rows.map(row => ({ postId: row.id.toString(), body: row.body, writer: row.writer, date: row.written_on }));
  return { notice, posts, data: formatGuildBoard({ guildName: guild.guild_name, notice, posts }) };
}

// 길드 게시판 조회·등록·공지·초기화를 guild lock, 멱등 실행, 감사, outbox로 원자 처리합니다.
export class GuildBoardService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<GuildBoardResult> {
    const command = parseGuildBoardCommand(input.message);
    return this.database.withTransaction(async transaction => {
      const owner = (await transaction.query<OwnerRow[]>(
        `SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,
          CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) ranked_name
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id=identity.player_id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [input.externalUserId]))[0];
      if (owner === undefined) throw new ApplicationError("GUILD_BOARD_VERIFIED_USER_REQUIRED", "가입 정보를 확인해 주세요.", 403);
      requireGuildBoardBodyLimit(command, owner.ranked_name);
      const guild = (await transaction.query<GuildMemberRow[]>(
        `SELECT member.guild_id,guild.display_name guild_name,guild.version guild_version,member.role_code
         FROM guild_members member JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active'
         WHERE member.player_id=? FOR UPDATE`, [owner.player_id]))[0];
      if (guild === undefined) throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED", `❌ [${owner.ranked_name}] 님 길드에 가입되어 있지 않습니다.`, 404);

      const scope = `guild.board:${guild.guild_id.toString()}`;
      const key = eventKey(input.eventId);
      const claimed = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
        [randomUUID(), scope, key, owner.identity_id]);
      const operation = (await transaction.query<Array<{ id: bigint; result_json: string | GuildBoardResult | null }>>(
        "SELECT id,result_json FROM operations WHERE id=? FOR UPDATE", [claimed.insertId]))[0];
      if (operation === undefined) throw new Error("GUILD_BOARD_OPERATION_CLAIM_FAILED");
      if (operation.result_json !== null) return { ...stored(operation.result_json), replayed: true };

      let status: GuildBoardResult["status"] = "read";
      let resultCode = "read";
      let actionCode = "guild.board.read";
      let postId: string | undefined;
      let trimmedCount = 0;
      let clearedCount = 0;
      let guildVersion = guild.guild_version;

      if (command.kind === "POST") {
        status = "posted"; resultCode = "posted"; actionCode = "guild.board.post";
        const post = await transaction.execute(
          "INSERT INTO guild_board_posts(guild_id,author_player_id,author_display_name_snapshot,body,status,version) VALUES (?,?,?,?,'published',1)",
          [guild.guild_id, owner.player_id, owner.ranked_name, command.body]);
        postId = post.insertId.toString();
        const posts = await transaction.query<Array<{ id: bigint }>>(
          "SELECT id FROM guild_board_posts WHERE guild_id=? AND status='published' AND deleted_at IS NULL ORDER BY created_at DESC,id DESC FOR UPDATE", [guild.guild_id]);
        const stale = posts.slice(20);
        if (stale.length > 0) {
          const placeholders = stale.map(() => "?").join(",");
          const trimmed = await transaction.execute(`UPDATE guild_board_posts SET status='trimmed',deleted_at=UTC_TIMESTAMP(3),version=version+1 WHERE id IN (${placeholders})`, stale.map(row => row.id));
          trimmedCount = Number(trimmed.affectedRows);
        }
      } else if (command.kind === "NOTICE") {
        requireLeader(guild.role_code, owner.ranked_name, "NOTICE"); status = "notice_changed"; resultCode = "notice_changed"; actionCode = "guild.board.notice";
        await transaction.execute(
          `INSERT INTO guild_board_notices(guild_id,author_player_id,author_display_name_snapshot,body,version,updated_at)
           VALUES (?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE author_player_id=VALUES(author_player_id),author_display_name_snapshot=VALUES(author_display_name_snapshot),body=VALUES(body),version=version+1,updated_at=UTC_TIMESTAMP(3)`,
          [guild.guild_id, owner.player_id, owner.display_name, command.body]);
      } else if (command.kind === "CLEAR") {
        requireLeader(guild.role_code, owner.ranked_name, "CLEAR"); status = "cleared"; resultCode = "cleared"; actionCode = "guild.board.clear";
        const cleared = await transaction.execute(
          "UPDATE guild_board_posts SET status='cleared',deleted_at=UTC_TIMESTAMP(3),version=version+1 WHERE guild_id=? AND status='published' AND deleted_at IS NULL", [guild.guild_id]);
        clearedCount = Number(cleared.affectedRows);
      }

      if (command.kind !== "READ") {
        const changed = await transaction.execute("UPDATE guilds SET version=version+1 WHERE id=? AND version=?", [guild.guild_id, guild.guild_version]);
        if (changed.affectedRows !== 1n) throw new ApplicationError("GUILD_BOARD_VERSION_CONFLICT", "길드 게시판이 먼저 변경되었습니다.", 409);
        guildVersion += 1n;
      }

      const board = await readBoard(transaction, { ...guild, guild_version: guildVersion });
      const data = command.kind === "POST" ? `✅ [${owner.ranked_name}] 님 길드 게시글이 등록되었습니다.`
        : command.kind === "NOTICE" ? "📢 길드게시판 공지가 설정되었습니다."
        : command.kind === "CLEAR" ? `🧹 [${owner.ranked_name}] 님 길드게시판 게시글이 초기화되었습니다.`
        : board.data;
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.id, input.destinationId, JSON.stringify({ room: input.destinationId, data })]);
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, COMMAND_CODE, operation.id, resultCode]);
      const audit = await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild',?,?,?,'Iris 길드 게시판',?,UTC_TIMESTAMP(3))",
        [operation.id, owner.identity_id, guild.guild_id, actionCode, resultCode, JSON.stringify({ command: command.kind, postId: postId ?? null, trimmedCount, clearedCount, noticePreserved: command.kind === "CLEAR", guildVersion: guildVersion.toString() })]);
      const result: GuildBoardResult = { status, replayed: false, guildId: guild.guild_id.toString(), guildVersion: guildVersion.toString(), data, ...(postId === undefined ? {} : { postId }), ...(trimmedCount === 0 ? {} : { trimmedCount }), ...(command.kind !== "CLEAR" ? {} : { clearedCount }), outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.id]);
      return result;
    });
  }
}
