import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const BOARD_CODE = "legacy_public_board";
const STAMP_CODE = "LETTER_STAMP";
const MAX_POSTS = 10;

type ParsedLetter = { mode: "post"; body: string } | { mode: "clear" };
type Actor = { identity_id: bigint; player_id: bigint; display_name: string; };
type Operator = Actor & { operator_id: bigint; };
type Post = { id: bigint; status: string; deleted_at: Date | null; };

export interface LetterBoardResult {
  status: "posted" | "stamp_required" | "cleared" | "empty";
  data: string;
  outboxId: string;
  postId?: string;
  clearedCount?: number;
  evictedPostIds?: string[];
  replayed?: boolean;
}

// 자유문자 편지와 exact 삭제만 허용하고 `/편지삭제 내용` 충돌을 차단합니다.
export function parseLetterBoardCommand(message: string): ParsedLetter | null {
  if (message === "/편지삭제") return { mode: "clear" };
  const match = /^\/편지\s+(.+)$/u.exec(message);
  if (match === null) return null;
  const body = match[1]!.trim();
  return body === "" ? null : { mode: "post", body };
}

// 실제 실행 가능한 편지 게시판 명령만 공용 dispatch 후보로 인정합니다.
export function isLetterBoardCandidate(message: string | undefined): boolean {
  return message !== undefined && parseLetterBoardCommand(message) !== null;
}

// 편지 게시·삭제를 각각의 DB alias로 정규화합니다.
export function normalizeLetterBoardDispatchMessage(message: string): string {
  const parsed = parseLetterBoardCommand(message);
  return parsed?.mode === "post" ? "/편지" : parsed?.mode === "clear" ? "/편지삭제" : message;
}

// 편지 게시와 운영자 전체삭제를 snapshot·감사·outbox와 함께 원자 처리합니다.
export class LetterBoardService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<LetterBoardResult | null> {
    const parsed = parseLetterBoardCommand(input.message);
    if (parsed === null) return null;
    return withRetry(() => this.database.withTransaction(async (transaction) => {
      if (parsed.mode === "clear") return this.clear(transaction, input);
      return this.post(transaction, input, parsed.body);
    }));
  }

  private async post(transaction: DatabaseTransaction, input: { eventId: string; externalUserId: string; destinationId: string }, body: string): Promise<LetterBoardResult | null> {
    const actor = (await transaction.query<Actor[]>(
      `SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name
         FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
         JOIN player_profiles profile ON profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`,
      [input.externalUserId]
    ))[0];
    if (actor === undefined) return null;
    const claimed = await claim(transaction, "social.letter_board.post", input.eventId, "external_identity", actor.identity_id);
    if (claimed.result !== null) return { ...claimed.result, replayed: true };
    const board = (await transaction.query<Array<{ id: bigint }>>("SELECT id FROM community_boards WHERE code=? AND active=TRUE FOR UPDATE", [BOARD_CODE]))[0];
    if (board === undefined) throw new Error("Letter board definition missing.");
    const stamp = (await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
      `SELECT item.id item_id,COALESCE(stack.quantity,0) quantity,COALESCE(stack.version,0) version
         FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
        WHERE item.code=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`,
      [actor.player_id, STAMP_CODE]
    ))[0];
    if (stamp === undefined || stamp.quantity < 1n) return finish(transaction, { operationId: claimed.id, input, actor, commandCode: "SOCIAL_LETTER_BOARD_POST", action: "social.letter_board.post", status: "stamp_required", data: "우표💌가 없습니다.", summary: { mutation: false, bodyLength: body.length } });
    const changed = await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND quantity>=1 AND version=?", [actor.player_id, stamp.item_id, stamp.version]);
    if (changed.affectedRows !== 1n) throw new Error("Letter stamp version conflict.");
    await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,-1,'LETTER_BOARD_POST')", [claimed.id, actor.player_id, stamp.item_id]);
    const inserted = await transaction.execute("INSERT INTO community_posts(board_id,author_player_id,post_type_code,body,status,created_at) VALUES (?,?,'letter',?,'published',UTC_TIMESTAMP(3))", [board.id, actor.player_id, body]);
    const active = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM community_posts WHERE board_id=? AND status='published' AND deleted_at IS NULL ORDER BY created_at DESC,id DESC FOR UPDATE", [board.id]);
    const evicted = active.slice(MAX_POSTS).map((post) => post.id);
    if (evicted.length > 0) await transaction.execute(`UPDATE community_posts SET status='evicted',deleted_at=UTC_TIMESTAMP(3) WHERE id IN (${evicted.map(() => "?").join(",")})`, evicted);
    const stampBefore = BigInt(stamp.quantity);
    await transaction.execute("INSERT INTO community_post_operations(operation_id,post_id,player_id,stamp_item_id,stamp_before,stamp_after,evicted_count) VALUES (?,?,?,?,?,?,?)", [claimed.id, inserted.insertId, actor.player_id, stamp.item_id, stampBefore, stampBefore - 1n, evicted.length]);
    return finish(transaction, { operationId: claimed.id, input, actor, commandCode: "SOCIAL_LETTER_BOARD_POST", action: "social.letter_board.post", status: "posted", data: "편지가 게시판에 등록되었습니다.", postId: inserted.insertId, evicted, summary: { mutation: true, bodyLength: body.length, stampBefore: stampBefore.toString(), stampAfter: (stampBefore - 1n).toString(), evictedPostIds: evicted.map(String) } });
  }

  private async clear(transaction: DatabaseTransaction, input: { eventId: string; externalUserId: string; destinationId: string }): Promise<LetterBoardResult | null> {
    const operator = (await transaction.query<Operator[]>(
      `SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,mapping.operator_id
         FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
         JOIN player_profiles profile ON profile.player_id=player.id
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE
         JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='social.letter_board.clear'
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`,
      [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;
    const claimed = await claim(transaction, "social.letter_board.clear", input.eventId, "admin_operator", operator.operator_id);
    if (claimed.result !== null) return { ...claimed.result, replayed: true };
    const board = (await transaction.query<Array<{ id: bigint }>>("SELECT id FROM community_boards WHERE code=? AND active=TRUE FOR UPDATE", [BOARD_CODE]))[0];
    if (board === undefined) throw new Error("Letter board definition missing.");
    const posts = await transaction.query<Post[]>("SELECT id,status,deleted_at FROM community_posts WHERE board_id=? AND status='published' AND deleted_at IS NULL ORDER BY created_at,id FOR UPDATE", [board.id]);
    await transaction.execute("INSERT INTO community_board_clear_operations(operation_id,board_id,cleared_count) VALUES (?,?,?)", [claimed.id, board.id, posts.length]);
    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index]!;
      await transaction.execute("INSERT INTO community_board_clear_lines(operation_id,sequence_no,post_id,status_before,deleted_at_before) VALUES (?,?,?,?,?)", [claimed.id, index + 1, post.id, post.status, post.deleted_at]);
    }
    if (posts.length > 0) await transaction.execute("UPDATE community_posts SET status='deleted',deleted_at=UTC_TIMESTAMP(3) WHERE board_id=? AND status='published' AND deleted_at IS NULL", [board.id]);
    const status = posts.length === 0 ? "empty" : "cleared";
    const data = posts.length === 0 ? "삭제할 편지가 없습니다." : `편지 ${posts.length}개를 삭제했습니다.`;
    return finish(transaction, { operationId: claimed.id, input, actor: operator, commandCode: "SOCIAL_LETTER_BOARD_CLEAR", action: "social.letter_board.clear", status, data, cleared: posts, summary: { mutation: posts.length > 0, clearedCount: posts.length, postIds: posts.map((post) => post.id.toString()), restorable: true } });
  }
}

async function claim(transaction: DatabaseTransaction, scope: string, eventId: string, actorType: string, actorId: bigint): Promise<{ id: bigint; result: LetterBoardResult | null }> {
  const key = eventKey(eventId);
  await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", [randomUUID(), scope, key, actorType, actorId]);
  const operation = (await transaction.query<Array<{ id: bigint; result_json: string | LetterBoardResult | null }>>("SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]))[0];
  if (operation === undefined) throw new Error("Letter board operation claim failed.");
  return { id: operation.id, result: operation.result_json === null ? null : typeof operation.result_json === "string" ? JSON.parse(operation.result_json) : operation.result_json };
}

async function finish(transaction: DatabaseTransaction, value: { operationId: bigint; input: { eventId: string; destinationId: string }; actor: Actor; commandCode: string; action: string; status: LetterBoardResult["status"]; data: string; postId?: bigint; evicted?: bigint[]; cleared?: Post[]; summary: Record<string, unknown> }): Promise<LetterBoardResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [value.operationId, value.input.destinationId, JSON.stringify({ data: value.data })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [value.input.eventId, value.commandCode, value.operationId, value.status]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'community_board',NULL,?,?,'Iris letter board',?,UTC_TIMESTAMP(3))", [value.operationId, value.actor.identity_id, value.action, value.status, JSON.stringify(value.summary)]);
  const result: LetterBoardResult = { status: value.status, data: value.data, outboxId: outbox.insertId.toString(), postId: value.postId?.toString(), clearedCount: value.cleared?.length, evictedPostIds: value.evicted?.map(String), replayed: false };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), value.operationId]);
  return result;
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
async function withRetry<T>(work: () => Promise<T>): Promise<T> { let last: unknown; for (let attempt = 0; attempt < 3; attempt += 1) { try { return await work(); } catch (error) { last = error; const code = (error as { code?: string }).code; if (code !== "ER_LOCK_DEADLOCK" && code !== "ER_LOCK_WAIT_TIMEOUT") throw error; } } throw last; }
