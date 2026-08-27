import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

type Actor = { player_id: bigint; display_name: string };
type Target = { player_id: bigint };
type Reward = { reward_code: string; item_id: bigint; item_code: string; quantity: bigint };
export type OneDayPassSubscriptionResult = { status: "granted"; data: string; recipientCount: number; grantCount: number; outboxId: string; auditId: string; replayed: boolean };
const SCOPE = "support.pass.oneday.subscription", CODE = "ONE_DAY_PASS_SUBSCRIPTION";
const key = (value: string) => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stored = (value: string | OneDayPassSubscriptionResult) => typeof value === "string" ? JSON.parse(value) as OneDayPassSubscriptionResult : value;

// 활성 원데이패스 대상자 전체에 DB 정의 보상을 원자 지급합니다.
export class OneDayPassSubscriptionService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<OneDayPassSubscriptionResult> {
    const actors = await this.database.query<Actor[]>(`SELECT identity.player_id,COALESCE(profile.current_display_name,identity.display_name) display_name FROM external_identities identity LEFT JOIN player_profiles profile ON profile.player_id=identity.player_id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 2`, [input.externalUserId]);
    if (actors.length !== 1 || !["호이 남", "오픈채팅봇"].includes(actors[0]!.display_name)) throw new ApplicationError("ONE_DAY_PASS_SUBSCRIPTION_FORBIDDEN", "이 기능은 관리자만 사용할 수 있습니다.", 403);
    const actor = actors[0]!;
    return this.database.withTransaction(async transaction => {
      const idempotencyKey = key(input.eventId);
      const prior = (await transaction.query<Array<{ result_json: string | OneDayPassSubscriptionResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, idempotencyKey]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operationId = (await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, idempotencyKey, actor.player_id])).insertId;
      const targets = await transaction.query<Target[]>(`SELECT pass.player_id FROM player_support_passes pass JOIN players player ON player.id=pass.player_id AND player.status='active' WHERE pass.pass_code='oneday' AND pass.status='active' AND (pass.entitlement_kind='permanent' OR pass.end_date>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'))) ORDER BY pass.player_id FOR UPDATE`);
      const rewards = await transaction.query<Reward[]>(`SELECT reward.reward_code,reward.item_id,item.code item_code,reward.quantity FROM one_day_subscription_reward_definitions reward JOIN item_definitions item ON item.id=reward.item_id AND item.active=TRUE AND item.stackable=TRUE WHERE reward.active=TRUE ORDER BY reward.display_order,reward.reward_code`);
      if (rewards.length === 0) throw new ApplicationError("ONE_DAY_PASS_SUBSCRIPTION_REWARD_MISSING", "원데이패스 지급 보상 설정을 확인해 주세요.", 500);
      let sequence = 0, grantCount = 0;
      for (const target of targets) for (const reward of rewards) {
        await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [target.player_id, reward.item_id]);
        const stack = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [target.player_id, reward.item_id]))[0]!;
        await transaction.execute("UPDATE inventory_stacks SET quantity=?,version=? WHERE player_id=? AND item_id=? AND version=?", [stack.quantity + reward.quantity, stack.version + 1n, target.player_id, reward.item_id, stack.version]);
        sequence += 1; grantCount += 1;
        await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'one_day_pass_subscription')", [operationId, sequence, target.player_id, reward.item_id, reward.quantity]);
        await transaction.execute("INSERT INTO one_day_subscription_grants(operation_id,player_id,item_id,quantity,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))", [operationId, target.player_id, reward.item_id, reward.quantity]);
      }
      const data = "원데이 패키지가 후원 지급 완료되었습니다.";
      const audit = await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'player',?,'support_pass_group',NULL,'support.pass.oneday.subscription','granted','Iris 원데이패스 구독 지급',?,UTC_TIMESTAMP(3))", [operationId, actor.player_id, JSON.stringify({ recipientCount: targets.length, grantCount })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','granted',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, CODE, operationId]);
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
      const result: OneDayPassSubscriptionResult = { status: "granted", data, recipientCount: targets.length, grantCount, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), replayed: false };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
      return result;
    });
  }
}
