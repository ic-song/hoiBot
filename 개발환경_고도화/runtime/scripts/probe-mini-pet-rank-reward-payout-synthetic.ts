import assert from "node:assert/strict";
import { MiniPetRankRewardPayoutService } from "../src/mini-pet/mini-pet-rank-reward-payout-service.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const databaseName = required("DATABASE_NAME");
assert.match(databaseName, /^hoibot_minipet_rank_reward_payout(?:_[a-z0-9_]+)?$/i, "격리 미니펫 연금 DB만 사용할 수 있습니다.");
const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: databaseName, connectionLimit: 12, connectTimeoutMs: 5000 });
const operatorPlayer = 997521001n, unauthorizedPlayer = 997521999n;
const operatorIdentity = 997522001n, unauthorizedIdentity = 997522002n;
const operatorExternal = "997523001", unauthorizedExternal = "997523002", room = "고도화미니펫연금방";

interface State { snapshots: bigint; entries: bigint; runs: bigint; grants: bigint; ledgers: bigint; executions: bigint; audits: bigint; outboxes: bigint; targetQuantity: bigint }

async function insertRows(database: DatabaseClient, prefix: string, columns: number, rows: readonly (readonly unknown[])[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    await database.execute(`${prefix} VALUES ${chunk.map(() => `(${Array.from({ length: columns }, () => "?").join(",")})`).join(",")}`, chunk.flat());
  }
}

async function seedAuthority(): Promise<void> {
  await db.execute("INSERT INTO players(id,status,version) VALUES(?,'active',1),(?,'active',1)", [operatorPlayer, unauthorizedPlayer]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'호이 남',1)", [operatorPlayer]);
  await db.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(?,?,'kakao',?,'호이 남','linked'),(?,?,'kakao',?,'일반 회원','linked')", [operatorIdentity, operatorPlayer, operatorExternal, unauthorizedIdentity, unauthorizedPlayer, unauthorizedExternal]);
}

async function seedRanking(): Promise<bigint[]> {
  const players = [operatorPlayer, ...Array.from({ length: 200 }, (_, index) => 997524000n + BigInt(index + 1))];
  const extra = players.slice(1);
  await insertRows(db, "INSERT INTO players(id,status,version)", 3, extra.map((id) => [id, "active", 1]));
  await insertRows(db, "INSERT INTO player_profiles(player_id,current_display_name,version)", 3, extra.map((id, index) => [id, `합성회원${String(index + 2).padStart(3, "0")}`, 1]));
  const definition = await db.execute("INSERT INTO mini_pet_definitions(code,display_name,grade_code,grade_display_name,emoji_value,active) VALUES('SYNTHETIC-RANK-PET','합성 순위펫','normal','일반','🐹',TRUE)");
  const owned = players.map((playerId, index) => [playerId, definition.insertId, 0, 0, 1000000 - index, 0, 0, index + 1, 1, 1]);
  await insertRows(db, "INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,enhancement_level,battle_experience,castle_experience,raid_experience,bag_sequence,version,equipped)", 10, owned);
  const bag = Array.from({ length: 11 }, (_, index) => [operatorPlayer, definition.insertId, 0, 0, 100 - index, 0, 0, index + 1, 1, 0]);
  await insertRows(db, "INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,enhancement_level,battle_experience,castle_experience,raid_experience,bag_sequence,version,equipped)", 10, bag);
  return players;
}

async function run(eventId: string, externalUserId: string, periodKey: string) {
  const identityId = externalUserId === operatorExternal ? operatorIdentity : unauthorizedIdentity;
  await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,external_user_id,external_identity_id,event_kind,processing_status,received_at) VALUES(?,'iris',?,?,?,'message','processing',UTC_TIMESTAMP(3))", [eventId, eventId, externalUserId, identityId]);
  return new MiniPetRankRewardPayoutService(db, () => periodKey).handle({ eventId, externalUserId, channelId: room, message: "/연금지급" });
}

async function state(): Promise<State> {
  const row = (await db.query<Array<Record<keyof State, bigint | string>>>(`SELECT
    (SELECT COUNT(*) FROM mini_pet_rank_reward_snapshots) snapshots,
    (SELECT COUNT(*) FROM mini_pet_rank_reward_snapshot_entries) entries,
    (SELECT COUNT(*) FROM mini_pet_rank_reward_runs) runs,
    (SELECT COUNT(*) FROM mini_pet_rank_reward_grants) grants,
    (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='mini_pet_rank_reward_payout') ledgers,
    (SELECT COUNT(*) FROM command_executions WHERE command_code='MINI_PET_RANK_REWARD_PAYOUT') executions,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='mini_pet.rank_reward_payout') audits,
    (SELECT COUNT(*) FROM outbox_messages outbox_row JOIN operations operation_row ON operation_row.id=outbox_row.operation_id WHERE operation_row.idempotency_scope='mini_pet.rank_reward_payout') outboxes,
    (SELECT COALESCE(SUM(stack_row.quantity),0) FROM inventory_stacks stack_row JOIN item_definitions item_row ON item_row.id=stack_row.item_id WHERE item_row.code='pet_enhance_stone') targetQuantity`))[0]!;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, BigInt(value)])) as unknown as State;
}

async function probe(): Promise<void> {
  const registry = (await db.query<Array<{ rollout_state: string; aliases: bigint; rules: bigint }>>("SELECT registry.rollout_state,(SELECT COUNT(*) FROM command_aliases WHERE command_code='MINI_PET_RANK_REWARD_PAYOUT' AND command_text='/연금지급' AND active=TRUE) aliases,(SELECT COUNT(*) FROM mini_pet_rank_reward_rules WHERE active=TRUE) rules FROM command_registry registry WHERE registry.command_code='MINI_PET_RANK_REWARD_PAYOUT'"))[0]!;
  assert.deepEqual([registry.rollout_state, registry.aliases, registry.rules], ["SHADOW", 1n, 27n]);
  await seedAuthority();
  const unauthorizedBefore = await state();
  await assert.rejects(() => run("mpr-unauthorized", unauthorizedExternal, "2026-08-28"), /연금 지급 권한이 없습니다/);
  assert.deepEqual(await state(), unauthorizedBefore);

  const empty = await run("mpr-empty", operatorExternal, "2026-08-29");
  assert.deepEqual([empty.snapshotEntryCount, empty.rewardedPlayerCount, empty.totalRewardQuantity], ["0", "0", "0"]);
  const players = await seedRanking();

  const normal = await run("mpr-normal", operatorExternal, "2026-08-30");
  assert.deepEqual([normal.snapshotEntryCount, normal.rewardedPlayerCount, normal.totalRewardQuantity], ["201", "200", "1792"]);
  assert.deepEqual(await run("mpr-normal-replay", operatorExternal, "2026-08-30"), normal);
  const rank201 = (await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM inventory_stacks stack_row JOIN item_definitions item_row ON item_row.id=stack_row.item_id WHERE stack_row.player_id=? AND item_row.code='pet_enhance_stone'", [players[200]]))[0]!;
  assert.equal(rank201.count_value, 0n);

  const concurrent = await Promise.all([run("mpr-concurrent-a", operatorExternal, "2026-08-31"), run("mpr-concurrent-b", operatorExternal, "2026-08-31")]);
  assert.deepEqual(concurrent[0], concurrent[1]);
  assert.equal(concurrent[0].totalRewardQuantity, "1792");

  const beforeRollback = await state();
  await db.execute("CREATE TRIGGER synthetic_mini_pet_rank_reward_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='mini pet rank reward probe failure'");
  await assert.rejects(() => run("mpr-rollback", operatorExternal, "2026-09-01"), /mini pet rank reward probe failure/);
  await db.execute("DROP TRIGGER synthetic_mini_pet_rank_reward_failure");
  assert.deepEqual(await state(), beforeRollback);
  assert.equal(await db.verifyRollback(), true);
  const retry = await run("mpr-rollback", operatorExternal, "2026-09-01");
  assert.equal(retry.totalRewardQuantity, "1792");

  const current = await state();
  assert.deepEqual(current, { snapshots: 4n, entries: 603n, runs: 4n, grants: 600n, ledgers: 600n, executions: 4n, audits: 4n, outboxes: 8n, targetQuantity: 5376n });
  process.stdout.write(JSON.stringify({ mode: "probe", migration: "339_mini_pet_rank_reward_payout.sql", scenarios: ["shadow", "authority-denied", "empty", "top10-plus-equipped", "201-boundary", "reward-total", "period-replay", "period-concurrency", "rollback", "retry"], state: current }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

async function restart(): Promise<void> {
  const before = await state();
  const replay = await run("mpr-restart-replay", operatorExternal, "2026-08-30");
  assert.deepEqual([replay.snapshotEntryCount, replay.rewardedPlayerCount, replay.totalRewardQuantity], ["201", "200", "1792"]);
  assert.deepEqual(await state(), before);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", replay: { periodKey: replay.periodKey, snapshotEntryCount: replay.snapshotEntryCount, rewardedPlayerCount: replay.rewardedPlayerCount, totalRewardQuantity: replay.totalRewardQuantity }, state: before, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

function required(name: string): string { const value = process.env[name]; if (value === undefined || value === "") throw new Error(`${name} required`); return value; }
try { if (process.argv.includes("--verify-restart")) await restart(); else await probe(); } finally { await db.close(); }
