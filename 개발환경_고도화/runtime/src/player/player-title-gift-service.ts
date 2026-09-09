import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { MariaPlayerTitleDefinitionLinkRepository } from "./maria-player-title-definition-link-repository.js";
import { PlayerTitleDefinitionLinkProvider } from "./player-title-definition-link.js";

const COMMAND = "/타이틀선물";
const COMMAND_CODE = "PLAYER_TITLE_GIFT";
const TICKET_CODE = "legacy-title-gift-ticket";
export const TITLE_GIFT_TICKET_NAME = "타이틀선물권💝(/타이틀선물 닉네임 내용)";

export type PlayerTitleGiftParse =
  | { kind: "execute"; targetName: string; titleName: string }
  | { kind: "usage" }
  | { kind: "too_long" };

export interface PlayerTitleGiftResult {
  status: "applied" | "usage" | "too_long" | "ticket_required";
  data: string;
  outboxId: string;
  targetPlayerId?: string;
  titleId?: string;
  ticketQuantity?: string;
  created?: boolean;
  replayed?: boolean;
}

interface IdentityRow { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null; }
interface MemberRow { player_id: bigint; display_name: string; rank_emoji: string | null; }

// 레거시 startsWith 실행 경계를 그대로 후보 판정에 사용합니다.
export function isPlayerTitleGiftCandidate(message: string | undefined): boolean {
  return message?.startsWith(COMMAND) === true;
}

// 인자형 선물 명령을 DB 대표 별칭으로 정규화합니다.
export function normalizePlayerTitleGiftDispatchMessage(message: string): string {
  return isPlayerTitleGiftCandidate(message) ? COMMAND : message;
}

// 긴 닉네임을 우선해 대상과 최대 30자의 선물 타이틀을 분리합니다.
export function parsePlayerTitleGift(message: string, memberNames: string[]): PlayerTitleGiftParse {
  if (!isPlayerTitleGiftCandidate(message)) return { kind: "usage" };
  const content = message.slice(COMMAND.length).trim();
  const names = [...memberNames].sort((left, right) => right.length - left.length);
  for (const name of names) {
    const next = content.charAt(name.length);
    if (!content.startsWith(name) || (content.length !== name.length && next !== " ")) continue;
    const titleName = content.slice(name.length).trim();
    if (titleName === "" || /[\r\n]/.test(titleName)) return { kind: "usage" };
    if (titleName.length > 30) return { kind: "too_long" };
    return { kind: "execute", targetName: name, titleName };
  }
  return { kind: "usage" };
}

// 레거시 checkRank 형식으로 타이틀 선물 완료 문구를 생성합니다.
export function formatPlayerTitleGiftSuccess(target: MemberRow, sender: IdentityRow, titleName: string): string {
  return `[${target.rank_emoji ?? ""}${target.display_name}] 님의 타이틀이\n[${titleName}] 로 적용되었습니다💝\n\n보낸 사람: [${sender.rank_emoji ?? ""}${sender.display_name}]`;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | PlayerTitleGiftResult): PlayerTitleGiftResult {
  return typeof value === "string" ? JSON.parse(value) as PlayerTitleGiftResult : value;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; actor: IdentityRow; status: PlayerTitleGiftResult["status"];
  data: string; target?: MemberRow; titleId?: bigint; ticketQuantity?: bigint; created?: boolean;
}): Promise<PlayerTitleGiftResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId, input.status]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'player.title.gift',?,'Iris /타이틀선물',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.actor.identity_id, input.target?.player_id ?? input.actor.player_id, input.status, JSON.stringify({ titleId: input.titleId?.toString(), ticketQuantity: input.ticketQuantity?.toString(), created: input.created ?? false })]
  );
  const result: PlayerTitleGiftResult = {
    status: input.status, data: input.data, outboxId: outbox.insertId.toString(), targetPlayerId: input.target?.player_id.toString(),
    titleId: input.titleId?.toString(), ticketQuantity: input.ticketQuantity?.toString(), created: input.created, replayed: false
  };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 티켓 차감과 사용자 지정 타이틀 생성·선택을 하나의 DB transaction으로 처리합니다.
export class PlayerTitleGiftService {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly titleDefinitions = new PlayerTitleDefinitionLinkProvider(new MariaPlayerTitleDefinitionLinkRepository()),
  ) {}

  public async gift(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PlayerTitleGiftResult | null> {
    return this.database.withTransaction(async transaction => {
      const siege = (await transaction.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) active_count FROM castle_battle_seasons WHERE status='active' AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))"
      ))[0]?.active_count ?? 0n;
      if (siege > 0n) return null;

      const actor = (await transaction.query<IdentityRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
        JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (actor === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const key = eventKey(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | PlayerTitleGiftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='player.title.gift' AND idempotency_key=? FOR UPDATE", [key]
      ))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'player.title.gift',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id]
      )).insertId;

      const members = await transaction.query<MemberRow[]>(`SELECT player.id player_id,profile.current_display_name display_name,rank.rank_emoji
        FROM players player JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
        WHERE player.status='active' AND player.deleted_at IS NULL ORDER BY CHAR_LENGTH(profile.current_display_name) DESC,player.id`);
      const parsed = parsePlayerTitleGift(input.message, members.map(member => member.display_name));
      if (parsed.kind === "usage") return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, status: "usage", data: "올바른 형식: /타이틀선물 닉네임 [내용]" });
      if (parsed.kind === "too_long") return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, status: "too_long", data: "타이틀은 최대 30자까지 입력 가능합니다." });
      const target = members.find(member => member.display_name === parsed.targetName)!;

      const ticket = (await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(`SELECT stack.item_id,stack.quantity,stack.version
        FROM item_definitions item JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
        WHERE item.code=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`, [actor.player_id, TICKET_CODE]))[0];
      if (ticket === undefined || ticket.quantity < 1n) return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, target, status: "ticket_required", data: `${TITLE_GIFT_TICKET_NAME}이 없습니다.` });

      const definition = await this.titleDefinitions.ensureGift(transaction, parsed.titleName);
      const existing = (await transaction.query<Array<{ title_id: bigint }>>("SELECT title_id FROM player_titles WHERE player_id=? AND title_id=? FOR UPDATE", [target.player_id, definition.titleId]))[0];
      await transaction.execute("UPDATE player_title_instances SET equipped=FALSE WHERE player_id=? AND status='owned' AND equipped=TRUE", [target.player_id]);
      await transaction.execute("UPDATE player_titles SET equipped=FALSE WHERE player_id=? AND equipped=TRUE", [target.player_id]);
      const order = (await transaction.query<Array<{ max_order: bigint | null }>>("SELECT MAX(display_order) max_order FROM player_title_instances WHERE player_id=? AND status='owned' FOR UPDATE", [target.player_id]))[0]?.max_order ?? 0n;
      await transaction.execute("INSERT INTO player_title_instances(instance_key,player_id,title_id,title_catalog_entry_id,snapshot_name,source_operation_id,source_sequence_no,price_value,legacy_price_json,display_order,status,equipped,acquired_at,version) VALUES (UUID(),?,?,?,?,?,1,0,'0',?,'owned',TRUE,UTC_TIMESTAMP(3),1)", [target.player_id, definition.titleId, definition.catalogEntryId, parsed.titleName, operationId, order + 1n]);
      const created = existing === undefined;
      if (existing === undefined) {
        await transaction.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped,display_order,acquisition_price) VALUES (?,?,UTC_TIMESTAMP(3),TRUE,?,0)", [target.player_id, definition.titleId, order + 1n]);
      } else {
        await transaction.execute("UPDATE player_titles SET equipped=TRUE WHERE player_id=? AND title_id=?", [target.player_id, definition.titleId]);
      }
      const remaining = ticket.quantity - 1n;
      const changed = await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [remaining, actor.player_id, ticket.item_id, ticket.version]);
      if (changed.affectedRows !== 1n) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?, -1,'PLAYER_TITLE_GIFT_TICKET_USED')", [operationId, actor.player_id, ticket.item_id]);
      return complete(transaction, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, target, titleId: definition.titleId, ticketQuantity: remaining, created, status: "applied", data: formatPlayerTitleGiftSuccess(target, actor, parsed.titleName) });
    });
  }
}
