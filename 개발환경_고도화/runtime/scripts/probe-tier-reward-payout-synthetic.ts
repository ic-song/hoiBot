import assert from "node:assert/strict";
import { TierRewardPayoutService } from "../src/player/tier-reward-payout-service.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const databaseName = required("DATABASE_NAME");
assert.match(databaseName, /^hoibot_tier_reward_payout(?:_[a-z0-9_]+)?$/i, "격리 티어 보상 DB만 사용할 수 있습니다.");
const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: databaseName, connectionLimit: 12, connectTimeoutMs: 5000 });
const operatorPlayer = 997531001n, unauthorizedPlayer = 997531999n;
const operatorIdentity = 997532001n, unauthorizedIdentity = 997532002n;
const operatorExternal = "997533001", unauthorizedExternal = "997533002", room = "고도화티어보상방";
interface State { snapshots: bigint; entries: bigint; runs: bigint; grants: bigint; ledgers: bigint; executions: bigint; audits: bigint; outboxes: bigint; fragmentQuantity: bigint; diamondQuantity: bigint }

async function insertRows(database: DatabaseClient, prefix: string, columns: number, rows: readonly (readonly unknown[])[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    await database.execute(`${prefix} VALUES ${chunk.map(() => `(${Array.from({ length: columns }, () => "?").join(",")})`).join(",")}`, chunk.flat());
  }
}
async function seedAuthority(): Promise<void> {
  await db.execute("INSERT INTO players(id,status,version) VALUES(?,'active',1),(?,'active',1)", [operatorPlayer, unauthorizedPlayer]);
  await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,'호이 남',1),(?,'일반 회원',1)", [operatorPlayer, unauthorizedPlayer]);
  await db.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES(?,?,'kakao',?,'호이 남','linked'),(?,?,'kakao',?,'일반 회원','linked')", [operatorIdentity, operatorPlayer, operatorExternal, unauthorizedIdentity, unauthorizedPlayer, unauthorizedExternal]);
}
async function seedRanking(): Promise<bigint[]> {
  const players = Array.from({ length: 12 }, (_, index) => 997534000n + BigInt(index + 1));
  const names = ["고급회원", "일반회원", "가나다", "나다라", "회원05", "회원06", "회원07", "회원08", "회원09", "회원10", "회원11", "회원12"];
  await insertRows(db, "INSERT INTO players(id,status,version)", 3, players.map((id) => [id, "active", 1]));
  await insertRows(db, "INSERT INTO player_profiles(player_id,current_display_name,version)", 3, players.map((id, index) => [id, names[index], 1]));
  const definitions = await db.query<Array<{ id: bigint; code: string }>>("SELECT id,code FROM item_definitions WHERE code IN('ITEM-RWD-022','tier_advanced_ticket') ORDER BY code");
  const ids = new Map(definitions.map((row) => [row.code, row.id]));
  const regular = ids.get("ITEM-RWD-022")!, advanced = ids.get("tier_advanced_ticket")!;
  const rows: Array<[bigint, bigint, bigint, number]> = [[players[0]!, advanced, 1n, 1], [players[1]!, regular, 299n, 1]];
  const remaining = [250n, 250n, 220n, 210n, 200n, 190n, 180n, 170n, 160n, 150n];
  for (let index = 2; index < players.length; index += 1) rows.push([players[index]!, regular, remaining[index - 2]!, 1]);
  await insertRows(db, "INSERT INTO inventory_stacks(player_id,item_id,quantity,version)", 4, rows);
  return players;
}
async function run(eventId: string, externalUserId: string, periodKey: string) {
  const identityId = externalUserId === operatorExternal ? operatorIdentity : unauthorizedIdentity;
  await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,external_user_id,external_identity_id,event_kind,processing_status,received_at) VALUES(?,'iris',?,?,?,'message','processing',UTC_TIMESTAMP(3))", [eventId, eventId, externalUserId, identityId]);
  return new TierRewardPayoutService(db, () => periodKey).handle({ eventId, externalUserId, channelId: room, message: "/티어보상지급" });
}
async function state(): Promise<State> {
  const row = (await db.query<Array<Record<keyof State, bigint | string>>>(`SELECT
    (SELECT COUNT(*) FROM tier_reward_snapshots) snapshots,
    (SELECT COUNT(*) FROM tier_reward_snapshot_entries) entries,
    (SELECT COUNT(*) FROM tier_reward_payout_runs) runs,
    (SELECT COUNT(*) FROM tier_reward_payout_grants) grants,
    (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='tier_reward_payout') ledgers,
    (SELECT COUNT(*) FROM command_executions WHERE command_code='TIER_REWARD_PAYOUT') executions,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='tier.reward_payout') audits,
    (SELECT COUNT(*) FROM outbox_messages outbox_row JOIN operations operation_row ON operation_row.id=outbox_row.operation_id WHERE operation_row.idempotency_scope='tier.reward_payout') outboxes,
    (SELECT COALESCE(SUM(stack_row.quantity),0) FROM inventory_stacks stack_row JOIN item_definitions item_row ON item_row.id=stack_row.item_id WHERE item_row.code='pet_skill_book_fragment') fragmentQuantity,
    (SELECT COALESCE(SUM(stack_row.quantity),0) FROM inventory_stacks stack_row JOIN item_definitions item_row ON item_row.id=stack_row.item_id WHERE item_row.code='ITEM-RWD-053') diamondQuantity`))[0]!;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, BigInt(value)])) as unknown as State;
}
async function probe(): Promise<void> {
  const registry = (await db.query<Array<{ rollout_state: string; aliases: bigint; score_rules: bigint; reward_rules: bigint }>>("SELECT registry.rollout_state,(SELECT COUNT(*) FROM command_aliases WHERE command_code='TIER_REWARD_PAYOUT' AND command_text='/티어보상지급' AND active=TRUE) aliases,(SELECT COUNT(*) FROM tier_reward_score_rules WHERE active=TRUE) score_rules,(SELECT COUNT(*) FROM tier_reward_rule_items WHERE active=TRUE) reward_rules FROM command_registry registry WHERE registry.command_code='TIER_REWARD_PAYOUT'"))[0]!;
  assert.deepEqual([registry.rollout_state, registry.aliases, registry.score_rules, registry.reward_rules], ["SHADOW", 1n, 2n, 14n]);
  await seedAuthority();
  const unauthorizedBefore = await state();
  await assert.rejects(() => run("trp-unauthorized", unauthorizedExternal, "2026-08-28"), /티어 보상 지급 권한이 없습니다/);
  assert.deepEqual(await state(), unauthorizedBefore);
  const empty = await run("trp-empty", operatorExternal, "2026-08-29");
  assert.deepEqual([empty.snapshotEntryCount, empty.rewardedPlayerCount, empty.grantCount, empty.totalItemQuantity], ["0", "0", "0", "0"]);
  assert.equal(empty.data, "현재 티어순위 데이터가 없어 보상을 지급할 수 없습니다.");
  const players = await seedRanking();
  const normal = await run("trp-normal", operatorExternal, "2026-08-30");
  assert.deepEqual([normal.snapshotEntryCount, normal.rewardedPlayerCount, normal.grantCount, normal.totalItemQuantity], ["12", "10", "14", "24"]);
  assert.deepEqual(await run("trp-normal-replay", operatorExternal, "2026-08-30"), normal);
  const ranking = await db.query<Array<{ rank_no: bigint; player_id: bigint; score: bigint }>>("SELECT rank_no,player_id,score FROM tier_reward_snapshot_entries WHERE snapshot_id=? ORDER BY rank_no", [BigInt(normal.snapshotId)]);
  assert.deepEqual(ranking.slice(0, 4).map((row) => [row.player_id, row.score]), [[players[0], 300n], [players[1], 299n], [players[2], 250n], [players[3], 250n]]);
  const excluded = (await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM tier_reward_payout_grants WHERE period_key='2026-08-30' AND player_id IN (?,?)", [players[10], players[11]]))[0]!;
  assert.equal(excluded.count_value, 0n);
  const concurrent = await Promise.all([run("trp-concurrent-a", operatorExternal, "2026-08-31"), run("trp-concurrent-b", operatorExternal, "2026-08-31")]);
  assert.deepEqual(concurrent[0], concurrent[1]);
  assert.deepEqual([concurrent[0].grantCount, concurrent[0].totalItemQuantity], ["14", "24"]);
  const beforeRollback = await state();
  await db.execute("CREATE TRIGGER synthetic_tier_reward_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='tier reward probe failure'");
  await assert.rejects(() => run("trp-rollback", operatorExternal, "2026-09-01"), /tier reward probe failure/);
  await db.execute("DROP TRIGGER synthetic_tier_reward_failure");
  assert.deepEqual(await state(), beforeRollback);
  assert.equal(await db.verifyRollback(), true);
  const retry = await run("trp-rollback", operatorExternal, "2026-09-01");
  assert.deepEqual([retry.grantCount, retry.totalItemQuantity], ["14", "24"]);
  const current = await state();
  assert.deepEqual(current, { snapshots: 4n, entries: 36n, runs: 4n, grants: 42n, ledgers: 42n, executions: 4n, audits: 4n, outboxes: 8n, fragmentQuantity: 33n, diamondQuantity: 39n });
  process.stdout.write(JSON.stringify({ mode: "probe", migration: "340_tier_reward_payout.sql", scenarios: ["shadow", "authority-denied", "empty", "advanced-x300", "korean-name-tie", "top10-boundary", "reward-total", "period-replay", "period-concurrency", "rollback", "retry"], state: current }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}
async function restart(): Promise<void> {
  const before = await state();
  const replay = await run("trp-restart-replay", operatorExternal, "2026-08-30");
  assert.deepEqual([replay.snapshotEntryCount, replay.rewardedPlayerCount, replay.grantCount, replay.totalItemQuantity], ["12", "10", "14", "24"]);
  assert.deepEqual(await state(), before);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", replay: { periodKey: replay.periodKey, snapshotEntryCount: replay.snapshotEntryCount, rewardedPlayerCount: replay.rewardedPlayerCount, grantCount: replay.grantCount, totalItemQuantity: replay.totalItemQuantity }, state: before, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}
function required(name: string): string { const value = process.env[name]; if (value === undefined || value === "") throw new Error(`${name} required`); return value; }
try { if (process.argv.includes("--verify-restart")) await restart(); else await probe(); } finally { await db.close(); }
