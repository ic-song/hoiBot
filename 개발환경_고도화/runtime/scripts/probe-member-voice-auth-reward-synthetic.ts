import assert from "node:assert/strict";
import { MemberVoiceAuthRewardService } from "../src/admin/member-voice-auth-reward-service.js";
import { createDatabaseClient } from "../src/database.js";

const required = (name: string): string => process.env[name] ?? (() => { throw new Error(`${name} is required`); })();
const database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 3, connectTimeoutMs: 5_000 });
const suffix = Date.now().toString();

try {
  await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`voice-probe-${suffix}`, "합성 probe 관리자", "synthetic"]);
  const operatorId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`voice-probe-${suffix}`]))[0]!.id;
  await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
  const operatorPlayerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
  await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
  const targetPlayerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
  const targetName = `합성 probe 인증 회원 ${suffix}`;
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [targetPlayerId, targetName]);
  const input = { message: `/인증 ${targetName}`, idempotencyKey: `probe:${suffix}`, sourceEventId: `probe:${suffix}`, destinationId: "probe-room", operatorId: operatorId.toString(), operatorPlayerId: operatorPlayerId.toString(), operatorDisplayName: "합성 probe 관리자" };
  await database.execute(
    "INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'command','processed',UTC_TIMESTAMP(3))",
    [input.sourceEventId]
  );
  const first = await new MemberVoiceAuthRewardService(database).grant(input);
  const replay = await new MemberVoiceAuthRewardService(database).grant(input);
  assert.deepEqual(replay, first);
  const state = (await database.query<Array<{ verified: bigint; item_quantity: bigint; point_balance: string; check_count: string; events: bigint }>>(
    `SELECT
     (SELECT COUNT(*) FROM player_verifications WHERE player_id=? AND verification_code='voice') verified,
     (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-RWD-001') item_quantity,
     (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=? AND currency_code='POINT') point_balance,
     (SELECT CAST(check_count AS CHAR) FROM player_check_counts WHERE player_id=?) check_count,
     (SELECT COUNT(*) FROM admin_member_voice_auth_reward_events WHERE target_player_id=?) events`,
    [targetPlayerId, operatorPlayerId, operatorPlayerId, operatorPlayerId, targetPlayerId]
  ))[0]!;
  assert.deepEqual([Number(state.verified), Number(state.item_quantity), state.point_balance, state.check_count, Number(state.events)], [1,20,"5000000.000","1",1]);
  process.stdout.write(JSON.stringify({ targetPlayerId: targetPlayerId.toString(), operatorPlayerId: operatorPlayerId.toString(), verified: Number(state.verified), itemQuantity: Number(state.item_quantity), pointBalance: state.point_balance, checkCount: state.check_count, events: Number(state.events), replayAdditionalMutation: false }) + "\n");
} finally {
  await database.close();
}
