import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE = "SPIRIT_ENHANCE";
const HANDLER_KEY = "spirit_enhance";
const STONE_CODE = "ITEM-ELEMENTAL-UPGRADE-STONE";
const MAX_ATTEMPTS = 100;

interface GradePolicy {
  grade_code: string;
  grade_display_name: string;
  grade_order: number;
  names_json: string | string[];
  success_rate: string;
  drop_rate: string;
  item_cost: bigint;
  point_cost: string;
  max_level: bigint;
  castle_exp: bigint;
  castle_upgrade_exp: bigint;
  raid_exp: bigint;
  raid_upgrade_exp: bigint;
}

interface SpiritState {
  name: string;
  gradeCode: string;
  grade: string;
  level: bigint;
}

interface BoostStack {
  itemId: bigint;
  name: string;
  quantity: bigint;
  addRate: number;
}

export interface SpiritEnhanceResult {
  status: "applied" | "missing_pet" | "insufficient_stone" | "insufficient_point";
  data: string;
  outboxId: string;
  auditId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  stonePreserved: number;
  pointSpent: string;
  stoneSpent: string;
  grade: string | null;
  level: string | null;
}

export interface ResolveSpiritAttemptInput {
  state: SpiritState;
  policy: GradePolicy;
  nextPolicy?: GradePolicy;
  smith: boolean;
  artisan: boolean;
  boostRate: number;
  random: () => number;
}

export interface ResolveSpiritAttemptResult {
  state: SpiritState;
  success: boolean;
  dropped: boolean;
  promoted: boolean;
  stonePreserved: boolean;
  effectiveRate: number;
}

// 정령강화는 인자 없음 또는 하나의 10진 정수 전체 형식만 허용합니다.
export function isSpiritEnhanceCommand(message: string | undefined): boolean {
  return message === "/정령강화" || (message !== undefined && /^\/정령강화\s+\d+$/.test(message));
}

// 레거시 기본 1회와 최대 100회 보정을 적용합니다.
export function parseSpiritEnhanceCount(message: string): { count: number; capped: boolean } {
  if (message === "/정령강화") return { count: 1, capped: false };
  const match = message.match(/^\/정령강화\s+(\d+)$/);
  if (match === null) return { count: 0, capped: false };
  const parsed = Number(match[1]);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_ATTEMPTS) return { count: MAX_ATTEMPTS, capped: true };
  return { count: parsed, capped: false };
}

// 한 번의 정령강화 판정을 레거시 난수 소비 순서로 계산합니다.
export function resolveSpiritAttempt(input: ResolveSpiritAttemptInput): ResolveSpiritAttemptResult {
  const baseRate = Number(input.policy.success_rate);
  const traitRate = input.smith ? 0.05 : 0;
  const effectiveRate = Math.min(1, baseRate + traitRate + (baseRate + traitRate < 1 ? input.boostRate : 0));
  const success = input.random() < effectiveRate;
  const state = { ...input.state };
  let dropped = false;
  let promoted = false;
  let stonePreserved = false;
  if (!success) {
    stonePreserved = input.artisan && input.random() < 0.07;
    dropped = input.random() < Number(input.policy.drop_rate);
    if (dropped && state.level > 0n) state.level -= 1n;
  } else {
    state.level += 1n;
    if (state.level > BigInt(input.policy.max_level) && input.nextPolicy !== undefined) {
      const names = parseNames(input.nextPolicy.names_json);
      state.level = 0n;
      state.gradeCode = input.nextPolicy.grade_code;
      state.grade = input.nextPolicy.grade_display_name;
      state.name = names[Math.floor(input.random() * names.length)] ?? names[0] ?? state.name;
      promoted = true;
    }
  }
  return { state, success, dropped, promoted, stonePreserved, effectiveRate };
}

// MariaDB JSON 이름 목록을 문자열 배열로 복원합니다.
function parseNames(value: string | string[]): string[] {
  return Array.isArray(value) ? value : JSON.parse(value) as string[];
}

// DECIMAL 포인트를 레거시 정수 포인트로 변환합니다.
function parsePoint(value: string): bigint {
  return BigInt(value.split(".")[0] ?? "0");
}

// 정수를 세 자리 쉼표 형식으로 표시합니다.
function comma(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 긴 이벤트 ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | SpiritEnhanceResult): SpiritEnhanceResult {
  return typeof value === "string" ? JSON.parse(value) as SpiritEnhanceResult : value;
}

// 보유한 정령 확률 부스트 중 가장 높은 수치를 선택합니다.
function bestBoost(rows: Array<{ item_id: bigint; display_name: string; quantity: bigint }>): BoostStack | undefined {
  let best: BoostStack | undefined;
  for (const row of rows) {
    const match = row.display_name.match(/^정령강화확률UP🥀\((\d+(?:\.\d+)?)%\)$/);
    const quantity = BigInt(row.quantity);
    if (match === null || quantity <= 0n) continue;
    const addRate = Number(match[1]) / 100;
    if (best === undefined || addRate > best.addRate) best = { itemId: BigInt(row.item_id), name: row.display_name, quantity, addRate };
  }
  return best;
}

// inventory stack 차감과 원장 기록을 같은 transaction에서 수행합니다.
async function consumeStack(transaction: DatabaseTransaction, operationId: bigint, sequence: number, playerId: string,
  itemId: bigint, owned: bigint, quantity: bigint, reason: string): Promise<void> {
  if (quantity <= 0n) return;
  if (quantity === owned) await transaction.execute("DELETE FROM inventory_stacks WHERE player_id=? AND item_id=?", [playerId, itemId]);
  else await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=?", [quantity, playerId, itemId]);
  await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,?)",
    [operationId, sequence, playerId, itemId, -quantity, reason]);
}

// 정령 강화 상태·포인트·아이템·감사·Outbox를 원자 처리합니다.
export class SpiritEnhanceService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" }
  > {
    const rollout = await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>(
      "SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [COMMAND_CODE]);
    const definition = rollout[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state === "SHADOW" || definition.rollout_state === "CANARY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "shadow" };
    }
    const identities = await this.database.query<Array<{ id: bigint; player_id: bigint | null }>>(
      "SELECT id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1", [input.externalUserId]);
    const identity = identities[0];
    if (identity === undefined || identity.player_id === null) {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
        { route: "LEGACY_FALLBACK", reasonCode: "IDENTITY_NOT_VERIFIED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
      return { status: "legacy_fallback" };
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true },
      { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: COMMAND_CODE, handlerKey: HANDLER_KEY });
    const parsed = parseSpiritEnhanceCount(input.message);
    const result = await this.enhance({ playerId: identity.player_id.toString(), identityId: identity.id.toString(), destinationId: input.channelId,
      sourceEventId: input.eventId, idempotencyKey: input.eventId, count: parsed.count, capped: parsed.capped });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async enhance(input: { playerId: string; identityId: string; destinationId: string; sourceEventId: string; idempotencyKey: string;
    count: number; capped?: boolean }): Promise<SpiritEnhanceResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `pet.spirit_enhance:${input.playerId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | SpiritEnhanceResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, eventKey]);
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const pets = await transaction.query<Array<{ id: bigint; display_name: string; version: bigint }>>(
        "SELECT id,display_name,version FROM player_pets WHERE player_id=? AND display_name IS NOT NULL FOR UPDATE", [input.playerId]);
      const pet = pets[0];
      const policies = await transaction.query<GradePolicy[]>("SELECT * FROM elemental_enhancement_grades WHERE active=TRUE ORDER BY grade_order FOR UPDATE");
      if (policies.length === 0) throw new Error("Elemental enhancement grade policy is empty.");
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, eventKey, input.identityId]);

      let status: SpiritEnhanceResult["status"] = "missing_pet";
      let data = "펫이 없습니다.";
      let attempted = 0, succeeded = 0, failed = 0, stonePreserved = 0;
      let pointSpent = 0n, stoneSpent = 0n;
      let state: SpiritState | null = null;
      let elementalVersion = 0n;
      let elementalExisted = false;
      const resultLogs: string[] = [];
      let stopReason = "";
      const boostSpent = new Map<bigint, { row: BoostStack; quantity: bigint }>();

      if (pet !== undefined) {
        const elementalRows = await transaction.query<Array<{ display_name: string; grade_code: string; grade_display_name: string; enhancement_level: bigint; version: bigint }>>(
          "SELECT display_name,grade_code,grade_display_name,enhancement_level,version FROM player_pet_elementals WHERE player_pet_id=? FOR UPDATE", [pet.id]);
        const current = elementalRows[0];
        elementalExisted = current !== undefined;
        elementalVersion = current?.version ?? 0n;
        const first = policies[0]!;
        state = current === undefined
          ? { name: parseNames(first.names_json)[0]!, gradeCode: first.grade_code, grade: first.grade_display_name, level: 0n }
          : { name: current.display_name, gradeCode: current.grade_code, grade: current.grade_display_name, level: BigInt(current.enhancement_level) };
        await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [input.playerId]);
        const accountRows = await transaction.query<Array<{ balance: string; version: bigint }>>(
          "SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [input.playerId]);
        const account = accountRows[0]!;
        let pointBalance = parsePoint(account.balance);
        const stoneRows = await transaction.query<Array<{ item_id: bigint; quantity: bigint }>>(
          "SELECT item.id item_id,COALESCE(stack.quantity,0) quantity FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code=? AND item.active=TRUE FOR UPDATE",
          [input.playerId, STONE_CODE]);
        const stone = stoneRows[0];
        let stoneBalance = BigInt(stone?.quantity ?? 0n);
        const boostRows = await transaction.query<Array<{ item_id: bigint; display_name: string; quantity: bigint }>>(
          "SELECT item.id item_id,item.display_name,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.display_name LIKE '정령강화확률UP🥀(%' AND item.active=TRUE FOR UPDATE", [input.playerId]);
        const skills = await transaction.query<Array<{ display_name: string }>>(
          "SELECT skill.display_name FROM pet_skills owned JOIN skill_definitions skill ON skill.id=owned.skill_id WHERE owned.player_pet_id=? AND owned.equipped=TRUE AND skill.display_name IN ('꽃집 대장장이','장인의 숨결')", [pet.id]);
        const smith = skills.some((row) => row.display_name === "꽃집 대장장이");
        const artisan = skills.some((row) => row.display_name === "장인의 숨결");
        const before = { ...state };

        for (let index = 0; index < input.count; index++) {
          const policyIndex = policies.findIndex((row) => row.grade_code === state!.gradeCode || row.grade_display_name === state!.grade);
          if (policyIndex < 0) throw new Error(`Unknown elemental grade: ${state.grade}`);
          const policy = policies[policyIndex]!;
          const pointCost = parsePoint(policy.point_cost);
          const itemCost = BigInt(policy.item_cost);
          if (stone === undefined || stoneBalance < itemCost) {
            status = "insufficient_stone";
            stopReason = `[${pet.display_name}] 님\n${state.name} [${state.grade}](+${state.level})\n정령 강화석🥀 ${comma(itemCost - stoneBalance)}개가 더 필요합니다.`;
            break;
          }
          if (pointBalance < pointCost) {
            status = "insufficient_point";
            stopReason = `[${pet.display_name}] 님 \n${state.name} [${state.grade}](+${state.level})\n\n🅟${comma(pointCost - pointBalance)} 가 더 필요합니다.`;
            break;
          }
          const availableBoosts = boostRows.map((row) => ({ ...row, quantity: BigInt(row.quantity) - (boostSpent.get(BigInt(row.item_id))?.quantity ?? 0n) }));
          const selectedBoost = Number(policy.success_rate) + (smith ? 0.05 : 0) < 1 ? bestBoost(availableBoosts) : undefined;
          const outcome = resolveSpiritAttempt({ state, policy, nextPolicy: policies[policyIndex + 1], smith, artisan,
            boostRate: selectedBoost?.addRate ?? 0, random: this.random });
          state = outcome.state;
          attempted += 1;
          pointSpent += pointCost;
          pointBalance -= pointCost;
          if (!outcome.stonePreserved) { stoneSpent += itemCost; stoneBalance -= itemCost; }
          else stonePreserved += 1;
          if (selectedBoost !== undefined) {
            const used = boostSpent.get(selectedBoost.itemId);
            boostSpent.set(selectedBoost.itemId, { row: selectedBoost, quantity: (used?.quantity ?? 0n) + 1n });
          }
          if (outcome.success) succeeded += 1; else failed += 1;
          const prefix = `[${pet.display_name}] 님\n${state.name} [${state.grade}](+${state.level})`;
          let message = outcome.success
            ? `${prefix}\n${outcome.promoted ? "으로 승급완료!" : "강화에 성공하셨습니다!!"}`
            : `${prefix}\n강화에 실패했습니다.${outcome.dropped ? " (하락 발생)" : ""}`;
          if (outcome.stonePreserved) message += "\n장인의 숨결📙 [정령 강화석🥀]을 소모하지 않았습니다.";
          message += `\n현재 포인트: 🅟${comma(pointBalance)}\n남은 정령 강화석🥀 : ${comma(stoneBalance)}개`;
          if (selectedBoost !== undefined) message += `\n${selectedBoost.name} 사용`;
          if (smith) message += "\n꽃집 대장장이📙 펫스킬을 적용 받았습니다(5%)";
          resultLogs.push(input.count === 1 ? message : `[${attempted}회]\n${message}`);
        }

        if (attempted > 0) {
          status = "applied";
          const update = await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",
            [`${pointBalance}.000`, input.playerId, account.version]);
          if (update.affectedRows !== 1n) throw new Error("Spirit enhancement point version conflict.");
          await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?, 'SPIRIT_ENHANCE')",
            [operation.insertId, input.playerId, `-${pointSpent}.000`, `${pointBalance}.000`]);
          let inventorySequence = 1;
          if (stone !== undefined) await consumeStack(transaction, operation.insertId, inventorySequence++, input.playerId, stone.item_id, stone.quantity, stoneSpent, "SPIRIT_ENHANCE_STONE");
          for (const spent of boostSpent.values()) await consumeStack(transaction, operation.insertId, inventorySequence++, input.playerId, spent.row.itemId, spent.row.quantity, spent.quantity, "SPIRIT_ENHANCE_BOOST");
          if (elementalExisted) {
            const updateElemental = await transaction.execute("UPDATE player_pet_elementals SET display_name=?,grade_code=?,grade_display_name=?,enhancement_level=?,version=version+1 WHERE player_pet_id=? AND version=?",
            [state.name, state.gradeCode, state.grade, state.level, pet.id, elementalVersion]);
            if (updateElemental.affectedRows !== 1n) throw new Error("Spirit enhancement elemental version conflict.");
          } else {
            await transaction.execute("INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,enhancement_level,version) VALUES (?,?,?,?,?,1)",
              [pet.id, state.name, state.gradeCode, state.grade, state.level]);
          }
          if (input.count === 1) data = resultLogs[0]!;
          else {
            const cap = input.capped ? "정령강화는 최대 100회까지만 가능합니다. 100회로 진행합니다.\n" : "";
            data = `${cap}🥀정령강화 연속시도🥀\n\n강화 전: ${before.name} [${before.grade}](+${before.level})\n강화 후: ${state.name} [${state.grade}](+${state.level})\n\n시도🔂: [${attempted}/${input.count}회]\n성공🅾️: [${succeeded}회]\n실패❌: [${failed}회]`;
            if (stonePreserved > 0) data += `\n장인의 숨결📙 발동: [${stonePreserved}회] (강화석 미소모)`;
            data += `\n현재 포인트: 🅟${comma(pointBalance)}`;
            if (stopReason) data += "\n중간 종료: 재화 또는 재료가 부족합니다.";
            data += `\n(강화 기록 상세보기)\n\n${resultLogs.join("\n\n")}`;
          }
        } else data = stopReason;
      }

      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'spirit_enhance',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.sourceEventId, operation.insertId, status]);
      const audit = await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pet.spirit_enhance',?,'Iris /정령강화',?,UTC_TIMESTAMP(3))",
        [operation.insertId, input.identityId, input.playerId, status, JSON.stringify({ attempted, succeeded, failed, stonePreserved, pointSpent: pointSpent.toString(), stoneSpent: stoneSpent.toString(), grade: state?.grade ?? null, level: state?.level.toString() ?? null })]);
      const result: SpiritEnhanceResult = { status, data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), attempted, succeeded, failed,
        stonePreserved, pointSpent: pointSpent.toString(), stoneSpent: stoneSpent.toString(), grade: state?.grade ?? null, level: state?.level.toString() ?? null };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
