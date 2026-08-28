import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const SAFE_POINT_MAX = 9_007_199_254_740_991n;
const ELIGIBLE_TIERS = new Set(["king", "emperor", "god"]);

export interface HappyFoundationTransferFeeInput { eventId: string; externalUserId: string; destinationId: string; message: string; }
export interface HappyFoundationTransferFeeResult {
  status: "fee_changed" | "foundation_read" | "transferred" | "usage" | "blocked_by_castle_siege";
  data?: string;
  outboxId?: string;
  operationId?: string;
  replayed?: boolean;
  amount?: string;
  feeAmount?: string;
  senderBalanceAfter?: string;
  recipientBalanceAfter?: string;
  foundationTotalAfter?: string;
}

interface ActorRow { identity_id: bigint; player_id: bigint; display_name: string; tier_code: string | null; rank_emoji: string | null; }
interface PlayerRow { player_id: bigint; display_name: string; tier_code: string | null; rank_emoji: string | null; }
interface StateRow { configuration_set_id: bigint; captain_player_id: bigint | null; captain_name: string | null; total_amount: string; fee_rate: string; version: bigint; }
interface PolicyRow { minimum_fee_rate: string; maximum_fee_rate: string; fee_rate_step: string; member_fee_multiplier: string; membership_item_code: string; maximum_transfer_amount: string; }

type ParsedCommand =
  | { kind: "fee"; rateBasisPoints: bigint; rateText: string }
  | { kind: "read" }
  | { kind: "transfer"; targetName: string; amount: bigint }
  | { kind: "usage" };

// 행복재단 수수료·조회·이체 명령의 완전한 입력 형식만 허용합니다.
export function isHappyFoundationTransferFeeCommand(message: string | undefined): boolean {
  if (message === undefined) return false;
  return message === "/호이행복재단" || message === "/이체"
    || /^\/이체수수료변경\s+\d+(?:\.\d{1,2})?$/.test(message)
    || /^\/이체\s+\S(?:.*\S)?\s+\d+$/.test(message);
}

// 인자형 명령을 command registry의 canonical alias로 정규화합니다.
export function normalizeHappyFoundationTransferFeeDispatchMessage(message: string): string {
  if (/^\/이체수수료변경\s+/.test(message)) return "/이체수수료변경";
  if (/^\/이체\s+/.test(message)) return "/이체";
  return message;
}

// 소수점 둘째 자리까지의 수수료율을 정수 basis point로 변환합니다.
export function parseFeeRateBasisPoints(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

// 정수 포인트 금액과 DB 정책을 사용해 부동소수점 없이 수수료를 계산합니다.
export function calculateFoundationTransferFee(amount: bigint, rateBasisPoints: bigint, memberMultiplierBasisPoints = 10_000n): bigint {
  return amount * rateBasisPoints * memberMultiplierBasisPoints / 100_000_000n;
}

// DB의 0~1 배율 소수 넷째 자리를 10,000분율 정수로 변환합니다.
function parseMultiplierBasisPoints(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value);
  if (match === null) throw new ApplicationError("INVALID_FOUNDATION_POLICY", "행복재단 회원 수수료 정책이 올바르지 않습니다.", 409);
  return BigInt(match[1]!) * 10_000n + BigInt((match[2] ?? "").padEnd(4, "0") || "0");
}

// 긴 Iris event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  const raw = value.startsWith("iris:") ? value : `iris:${value}`;
  return raw.length <= 191 ? raw : `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

// DB decimal 문자열을 정수 포인트로 안전하게 변환합니다.
function integer(value: string): bigint { return BigInt(value.split(".")[0]!); }

// 정수 포인트를 사용자 응답용 천 단위 문자열로 표시합니다.
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 저장된 JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | HappyFoundationTransferFeeResult): HappyFoundationTransferFeeResult {
  return typeof value === "string" ? JSON.parse(value) as HappyFoundationTransferFeeResult : value;
}

// 입력 문자열을 수수료 변경, 상태 조회, 포인트 이체 또는 사용법으로 구분합니다.
function parseCommand(message: string): ParsedCommand {
  if (message === "/호이행복재단") return { kind: "read" };
  if (message === "/이체") return { kind: "usage" };
  const fee = /^\/이체수수료변경\s+(\d+(?:\.\d{1,2})?)$/.exec(message);
  if (fee !== null) {
    const rateBasisPoints = parseFeeRateBasisPoints(fee[1]!);
    if (rateBasisPoints !== null) return { kind: "fee", rateBasisPoints, rateText: fee[1]! };
  }
  const transfer = /^\/이체\s+(\S(?:.*\S)?)\s+(\d+)$/.exec(message);
  if (transfer !== null) {
    const amount = BigInt(transfer[2]!);
    return { kind: "transfer", targetName: transfer[1]!, amount };
  }
  throw new ApplicationError("INVALID_HAPPY_FOUNDATION_COMMAND", "❌ 사용법: /이체 [받는 유저] [포인트]", 422);
}

// 명령 실행자의 가입 신원과 프로필을 안정 ID로 해석합니다.
async function actor(tx: DatabaseTransaction, externalUserId: string): Promise<ActorRow> {
  const rows = await tx.query<ActorRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,profile.tier_code,rank.rank_emoji
    FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
    JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id
    WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 2 FOR UPDATE`, [externalUserId]);
  if (rows.length !== 1) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);
  return rows[0]!;
}

// 행복재단 상태와 정책을 같은 transaction에서 잠급니다.
async function stateAndPolicy(tx: DatabaseTransaction): Promise<{ state: StateRow; policy: PolicyRow }> {
  const states = await tx.query<StateRow[]>(`SELECT state.configuration_set_id,state.captain_player_id,captain.current_display_name captain_name,
    CAST(state.total_amount AS CHAR) total_amount,CAST(state.fee_rate AS CHAR) fee_rate,state.version
    FROM foundation_states state LEFT JOIN player_profiles captain ON captain.player_id=state.captain_player_id
    WHERE state.foundation_code='happy' FOR UPDATE`);
  const policies = await tx.query<PolicyRow[]>(`SELECT CAST(minimum_fee_rate AS CHAR) minimum_fee_rate,CAST(maximum_fee_rate AS CHAR) maximum_fee_rate,
    CAST(fee_rate_step AS CHAR) fee_rate_step,CAST(member_fee_multiplier AS CHAR) member_fee_multiplier,membership_item_code,
    CAST(maximum_transfer_amount AS CHAR) maximum_transfer_amount FROM foundation_transfer_policies WHERE foundation_code='happy' FOR UPDATE`);
  if (states[0] === undefined || policies[0] === undefined) throw new ApplicationError("HAPPY_FOUNDATION_STATE_REQUIRED", "행복재단 설정이 준비되지 않았습니다.", 409);
  return { state: states[0], policy: policies[0] };
}

// 성공 결과를 실행 원장·감사·Outbox와 함께 완결합니다.
async function complete(tx: DatabaseTransaction, input: HappyFoundationTransferFeeInput, operationId: bigint, actorRow: ActorRow,
  commandCode: string, actionCode: string, resultCode: string, data: string, summary: Record<string, unknown>, result: HappyFoundationTransferFeeResult,
  targetPlayerId: bigint | null = null): Promise<HappyFoundationTransferFeeResult> {
  const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, commandCode, operationId, resultCode]);
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris 행복재단',?,UTC_TIMESTAMP(3))", [operationId, actorRow.identity_id, targetPlayerId, actionCode, resultCode, JSON.stringify(summary)]);
  const completed = { ...result, data, outboxId: outbox.insertId.toString(), operationId: operationId.toString() };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(completed), operationId]);
  return completed;
}

// 행복재단 조회·수수료 변경·포인트 이체를 DB 원장과 함께 원자 처리합니다.
export class HappyFoundationTransferFeeService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: HappyFoundationTransferFeeInput): Promise<HappyFoundationTransferFeeResult> {
    const command = parseCommand(input.message);
    return this.database.withTransaction(async (tx) => {
      const actorRow = await actor(tx, input.externalUserId);
      const commandCode = command.kind === "fee" ? "HAPPY_FOUNDATION_FEE_CHANGE" : command.kind === "read" ? "HAPPY_FOUNDATION_READ" : "POINT_TRANSFER";
      const scope = `foundation.happy.${command.kind}:${actorRow.player_id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<Array<{ result_json: string | HappyFoundationTransferFeeResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]);
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return { ...stored(prior[0].result_json), replayed: true };

      if (command.kind === "transfer") {
        const siege = await tx.query<Array<{ active: number }>>("SELECT active FROM guild_territory_wars WHERE active=TRUE LIMIT 1 FOR UPDATE");
        if (siege[0]?.active === 1) return { status: "blocked_by_castle_siege" };
      }

      const operation = await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actorRow.identity_id]);
      const { state, policy } = await stateAndPolicy(tx);

      if (command.kind === "usage") {
        return complete(tx, input, operation.insertId, actorRow, commandCode, "foundation.happy.transfer.usage", "usage", "❌ 사용법: /이체 [받는 유저] [포인트]", { mutation: false }, { status: "usage" });
      }

      if (command.kind === "read") {
        const data = `[호이행복재단]\n단장: ${state.captain_name ?? "없음"}\n이체 수수료: ${state.fee_rate}%\n누적액: 🅟${commas(integer(state.total_amount))}`;
        return complete(tx, input, operation.insertId, actorRow, commandCode, "foundation.happy.read", "foundation_read", data,
          { mutation: false, captainPlayerId: state.captain_player_id?.toString() ?? null, feeRate: state.fee_rate, totalAmount: state.total_amount, version: state.version.toString() }, { status: "foundation_read" });
      }

      if (command.kind === "fee") {
        if (state.captain_player_id !== actorRow.player_id) throw new ApplicationError("HAPPY_FOUNDATION_CAPTAIN_REQUIRED", "행복재단 단장만 이체 수수료를 변경할 수 있습니다.", 403);
        const min = parseFeeRateBasisPoints(policy.minimum_fee_rate)!;
        const max = parseFeeRateBasisPoints(policy.maximum_fee_rate)!;
        const step = parseFeeRateBasisPoints(policy.fee_rate_step)!;
        if (command.rateBasisPoints < min || command.rateBasisPoints > max || (command.rateBasisPoints - min) % step !== 0n) {
          throw new ApplicationError("HAPPY_FOUNDATION_FEE_RATE_RANGE", `수수료율은 ${policy.minimum_fee_rate}%부터 ${policy.maximum_fee_rate}%까지 ${policy.fee_rate_step}% 단위로 입력해주세요.`, 422);
        }
        const normalizedRate = `${command.rateBasisPoints / 100n}.${(command.rateBasisPoints % 100n).toString().padStart(2, "0")}`;
        const write = await tx.execute("UPDATE foundation_states SET fee_rate=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE foundation_code='happy' AND version=?", [normalizedRate, state.version]);
        if (write.affectedRows !== 1n) throw new ApplicationError("HAPPY_FOUNDATION_CONFLICT", "행복재단 설정이 먼저 변경되었습니다.", 409);
        await tx.execute("INSERT INTO configuration_change_log(configuration_set_id,actor_id,action_code,change_json,created_at) VALUES (?,NULL,'foundation.fee.change',?,UTC_TIMESTAMP(3))", [state.configuration_set_id, JSON.stringify({ actorPlayerId: actorRow.player_id.toString(), previousFeeRate: state.fee_rate, feeRate: normalizedRate, versionBefore: state.version.toString(), versionAfter: (state.version + 1n).toString() })]);
        const data = `행복재단 이체 수수료를 ${normalizedRate}%로 변경했습니다.`;
        return complete(tx, input, operation.insertId, actorRow, commandCode, "foundation.happy.fee.change", "fee_changed", data,
          { previousFeeRate: state.fee_rate, feeRate: normalizedRate, versionBefore: state.version.toString(), versionAfter: (state.version + 1n).toString() }, { status: "fee_changed" });
      }

      if (command.amount <= 0n || command.amount > SAFE_POINT_MAX || command.amount > integer(policy.maximum_transfer_amount)) throw new ApplicationError("UNSAFE_TRANSFER_AMOUNT", "안전하게 처리할 수 있는 이체 금액을 입력해주세요.", 422);
      const targets = await tx.query<PlayerRow[]>(`SELECT profile.player_id,profile.current_display_name display_name,profile.tier_code,rank.rank_emoji
        FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active' AND player.deleted_at IS NULL
        LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=profile.player_id WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2 FOR UPDATE`, [command.targetName]);
      if (targets.length === 0) throw new ApplicationError("TRANSFER_TARGET_NOT_FOUND", `❌ [${command.targetName}] 님은 존재하지 않습니다.`, 404);
      if (targets.length > 1) throw new ApplicationError("TRANSFER_TARGET_AMBIGUOUS", "동일 표시명의 회원이 여러 명입니다.", 409);
      const recipient = targets[0]!;
      if (recipient.player_id === actorRow.player_id) throw new ApplicationError("TRANSFER_SELF", "❌ 자기 자신에게는 이체할 수 없습니다.", 409);
      if (!ELIGIBLE_TIERS.has(actorRow.tier_code ?? "")) throw new ApplicationError("TRANSFER_SENDER_TIER_REQUIRED", `❌[${actorRow.rank_emoji ?? ""}${actorRow.display_name}]님, 이체는 티어 👑킹 이상부터 가능합니다.`, 409);
      if (!ELIGIBLE_TIERS.has(recipient.tier_code ?? "")) throw new ApplicationError("TRANSFER_RECIPIENT_TIER_REQUIRED", `❌[${recipient.rank_emoji ?? ""}${recipient.display_name}]님은 티어 👑킹 미만이라 포인트를 받을 수 없습니다.`, 409);

      const member = await tx.query<Array<{ applied: bigint }>>(`SELECT EXISTS(SELECT 1 FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
        WHERE stack.player_id=? AND stack.quantity>0 AND item.code=?) applied`, [actorRow.player_id, policy.membership_item_code]);
      const rateBasisPoints = parseFeeRateBasisPoints(state.fee_rate)!;
      const multiplierBasisPoints = parseMultiplierBasisPoints(policy.member_fee_multiplier);
      const memberFeeApplied = (member[0]?.applied ?? 0n) > 0n;
      const feeAmount = calculateFoundationTransferFee(command.amount, rateBasisPoints, memberFeeApplied ? multiplierBasisPoints : 10_000n);
      const required = command.amount + feeAmount;
      if (required > SAFE_POINT_MAX) throw new ApplicationError("UNSAFE_TRANSFER_TOTAL", "이체 금액과 수수료 합계가 안전 범위를 초과했습니다.", 422);

      for (const playerId of [actorRow.player_id, recipient.player_id].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
        await tx.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)", [playerId]);
      }
      const accounts = await tx.query<Array<{ player_id: bigint; balance: string; version: bigint }>>("SELECT player_id,CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id IN (?,?) AND currency_code='point' ORDER BY player_id FOR UPDATE", [actorRow.player_id, recipient.player_id]);
      const senderAccount = accounts.find((row) => row.player_id === actorRow.player_id);
      const recipientAccount = accounts.find((row) => row.player_id === recipient.player_id);
      if (senderAccount === undefined || recipientAccount === undefined) throw new ApplicationError("TRANSFER_ACCOUNTS_REQUIRED", "포인트 계정을 준비하지 못했습니다.", 409);
      const senderBefore = integer(senderAccount.balance);
      const recipientBefore = integer(recipientAccount.balance);
      if (senderBefore < required) throw new ApplicationError("TRANSFER_BALANCE_REQUIRED", `❌ 포인트가 부족합니다. 필요 포인트: 🅟${commas(required)}`, 409);
      const senderAfter = senderBefore - required;
      const recipientAfter = recipientBefore + command.amount;
      const foundationBefore = integer(state.total_amount);
      const foundationAfter = foundationBefore + feeAmount;

      const senderWrite = await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [senderAfter, actorRow.player_id, senderAccount.version]);
      const recipientWrite = await tx.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [recipientAfter, recipient.player_id, recipientAccount.version]);
      const foundationWrite = await tx.execute("UPDATE foundation_states SET total_amount=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE foundation_code='happy' AND version=?", [foundationAfter, state.version]);
      if (senderWrite.affectedRows !== 1n || recipientWrite.affectedRows !== 1n || foundationWrite.affectedRows !== 1n) throw new ApplicationError("HAPPY_FOUNDATION_CONFLICT", "이체 대상 상태가 먼저 변경되었습니다.", 409);
      await tx.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'HAPPY_FOUNDATION_TRANSFER_OUT'),(?,2,?,'point',?,?,'HAPPY_FOUNDATION_TRANSFER_IN')", [operation.insertId, actorRow.player_id, -required, senderAfter, operation.insertId, recipient.player_id, command.amount, recipientAfter]);
      await tx.execute(`INSERT INTO foundation_transfers(operation_id,foundation_code,sender_player_id,recipient_player_id,amount,fee_rate,fee_amount,member_fee_applied,
        sender_balance_before,sender_balance_after,recipient_balance_before,recipient_balance_after,foundation_total_before,foundation_total_after,foundation_version_before,foundation_version_after)
        VALUES (?,'happy',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [operation.insertId, actorRow.player_id, recipient.player_id, command.amount, state.fee_rate, feeAmount, memberFeeApplied, senderBefore, senderAfter, recipientBefore, recipientAfter, foundationBefore, foundationAfter, state.version, state.version + 1n]);
      const data = `[${actorRow.rank_emoji ?? ""}${actorRow.display_name}] 님 → [${recipient.rank_emoji ?? ""}${recipient.display_name}] 님\n🅟${commas(command.amount)} 이체 완료\n수수료: 🅟${commas(feeAmount)}${memberFeeApplied ? " (행복재단 회원권 50% 적용)" : ""}\n남은 포인트: 🅟${commas(senderAfter)}`;
      return complete(tx, input, operation.insertId, actorRow, commandCode, "foundation.happy.transfer", "transferred", data,
        { amount: command.amount.toString(), feeRate: state.fee_rate, feeAmount: feeAmount.toString(), memberFeeApplied, senderBalanceBefore: senderBefore.toString(), senderBalanceAfter: senderAfter.toString(), recipientBalanceBefore: recipientBefore.toString(), recipientBalanceAfter: recipientAfter.toString(), foundationTotalBefore: foundationBefore.toString(), foundationTotalAfter: foundationAfter.toString() },
        { status: "transferred", amount: command.amount.toString(), feeAmount: feeAmount.toString(), senderBalanceAfter: senderAfter.toString(), recipientBalanceAfter: recipientAfter.toString(), foundationTotalAfter: foundationAfter.toString() }, recipient.player_id);
    });
  }
}
