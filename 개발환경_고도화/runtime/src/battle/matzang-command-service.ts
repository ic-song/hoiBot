import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MatzangFieldProvider, type MatzangProjection } from "./matzang-field-provider.js";

export type MatzangCommand = "battle" | "rank" | "field_list";
export type MatzangCommandResult = { status: "battle" | "rank" | "field_list" | "wrong_room" | "inactive" | "ignored"; data: string; outboxId?: string };
export type MatzangParticipantListRow = { displayName: string };
const ALL_SEE = "​".repeat(500);

// 레거시와 동일하게 완전 일치하는 맞짱 명령과 별칭만 분류합니다.
export function parseMatzangCommand(message: string): MatzangCommand | undefined {
  if (message === "/맞짱" || message === "ㅁㅁ") return "battle";
  if (message === "/맞짱필드목록") return "field_list";
  return message === "/맞짱순위" ? "rank" : undefined;
}

// 레거시 참여자 번호·대괄호·allsee·빈 목록 문구를 동일한 순서로 구성합니다.
export function formatMatzangParticipantList(rows: MatzangParticipantListRow[]): string {
  const lines = rows.map((row, index) => `${index + 1}. [${row.displayName}]`);
  return `👊 맞짱필드 참여자 목록 👊\n현재 참여자 ${rows.length}명${ALL_SEE}\n\n${lines.length > 0 ? lines.join("\n") : "참여자가 없습니다."}`;
}

// 전투 projection을 사용자용 맞짱 결과 카드로 변환합니다.
export function formatMatzangBattle(projection: MatzangProjection): string {
  const winner = projection.attackerWin ? projection.attacker.displayName : projection.defender.displayName;
  return ["👊 맞짱필드 결과", "", `${projection.attacker.displayName} VS ${projection.defender.displayName}`,
    `${projection.attacker.final.toLocaleString("ko-KR")} : ${projection.defender.final.toLocaleString("ko-KR")}`,
    `승자: ${winner}`, `획득 PT: ${projection.gainedPt}`, `획득 포인트: ${BigInt(projection.rewardPoint.split(".")[0]!).toLocaleString("ko-KR")}`,
    `남은 횟수: ${projection.remaining}`].join("\n");
}

// 맞짱 전투와 순위 명령의 방 제한·응답 원장을 DB 기준으로 처리합니다.
export class MatzangCommandService {
  private readonly provider: MatzangFieldProvider;
  constructor(private readonly db: DatabaseClient, random: () => number = Math.random) { this.provider = new MatzangFieldProvider(db, random); }

  async handle(input: { eventId: string; destinationId: string; playerId: string; message: string; fieldKey?: string }): Promise<MatzangCommandResult> {
    const command = parseMatzangCommand(input.message);
    if (command === undefined) return { status: "ignored", data: "" };
    const fieldKey = input.fieldKey ?? "current";
    if (command === "field_list") {
      const fields = await this.db.query<Array<{ active: number; max_count: number }>>("SELECT active,max_count FROM matzang_fields WHERE field_key=? LIMIT 1", [fieldKey]);
      const field = fields[0];
      if (field?.active !== 1) return this.reply(input, command, "inactive", "현재 맞짱필드👊가 진행 중이 아닙니다.");
      const rows = await this.db.query<Array<{ displayName: string }>>(
        `SELECT participant.display_name displayName FROM matzang_participants participant
         JOIN players player ON player.id=participant.player_id
         WHERE participant.field_key=? AND participant.active=TRUE AND participant.match_count<?
         ORDER BY participant.player_id`, [fieldKey, field.max_count]
      );
      return this.reply(input, command, "field_list", formatMatzangParticipantList(rows));
    }
    const allowed = await this.db.query<Array<{ allowed: number }>>("SELECT 1 allowed FROM matzang_room_scopes WHERE destination_id=? AND active=TRUE LIMIT 1", [input.destinationId]);
    if (allowed[0] === undefined) return this.reply(input, command, "wrong_room", "이 명령어는 맞짱필드👊 지정방에서만 사용할 수 있습니다.");
    if (command === "battle") {
      const result = await this.provider.battle({ eventId: input.eventId, destinationId: input.destinationId, attackerPlayerId: input.playerId, fieldKey: input.fieldKey, format: formatMatzangBattle });
      return { status: result.status === "battle" ? "battle" : "inactive", data: result.data, outboxId: result.outboxId };
    }
    const active = await this.db.query<Array<{ active: number }>>("SELECT active FROM matzang_fields WHERE field_key=? LIMIT 1", [fieldKey]);
    if (active[0]?.active !== 1) return this.reply(input, command, "inactive", "현재 맞짱필드👊가 진행 중이 아닙니다.");
    const rows = await this.provider.ranking(fieldKey);
    const data = ["👊 맞짱필드 순위", "", ...rows.map((row, index) => `${index + 1}. ${row.displayName} (${row.pt} PT)`)].join("\n");
    return this.reply(input, command, "rank", data);
  }

  private async reply(input: { eventId: string; destinationId: string; playerId: string }, command: MatzangCommand, status: "rank" | "field_list" | "wrong_room" | "inactive", data: string): Promise<MatzangCommandResult> {
    return this.db.withTransaction(async (transaction) => this.persistReply(transaction, input, command, status, data));
  }

  private async persistReply(transaction: DatabaseTransaction, input: { eventId: string; destinationId: string; playerId: string }, command: MatzangCommand, status: "rank" | "field_list" | "wrong_room" | "inactive", data: string): Promise<MatzangCommandResult> {
    const scope = `matzang.command.${command}`;
    const prior = await transaction.query<Array<{ result_json: string | MatzangCommandResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, input.eventId]);
    if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
    const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status) VALUES (?,?,?,'player',?,'iris','processing')", [randomUUID(), scope, input.eventId, input.playerId]);
    const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status) VALUES (?,'iris',?,'text',?,'pending')", [operation.insertId, input.destinationId, JSON.stringify({ data })]);
    const commandCode = command === "rank" ? "MATZZANG_RANK" : command === "field_list" ? "MATZZANG_FIELD_LIST" : "MATZZANG_BATTLE";
    await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, commandCode, operation.insertId, status]);
    await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json) VALUES (?,'player',?,'matzang_field',NULL,?,?,?,?)", [operation.insertId, input.playerId, `matzang.${command}`, status, "Iris 맞짱 명령", JSON.stringify({ status, mutation: false })]);
    const result: MatzangCommandResult = { status, data, outboxId: outbox.insertId.toString() };
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
    return result;
  }
}
