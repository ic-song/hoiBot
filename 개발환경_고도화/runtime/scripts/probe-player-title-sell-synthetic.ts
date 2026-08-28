import assert from "node:assert/strict";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PlayerTitleSellService } from "../src/player/player-title-sell-service.js";

const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5000 });
const player = 996100001n, identity = 996200001n, external = "996300001", room = "고도화타이틀판매방";

async function seed(database: DatabaseClient): Promise<void> {
  await database.execute("UPDATE castle_battle_seasons SET status='ended',ends_at=UTC_TIMESTAMP(3) WHERE status='active'");
  await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [player]);
  await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'판매회원')", [player]);
  await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES (?,?,'kakao',?,'linked')", [identity, player, external]);
  await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1)", [player]);
  await database.execute("INSERT INTO title_definitions(id,code,display_name,scope_code,active) VALUES (996400001,'SYNTHETIC-TITLE-1','합성최저','player',TRUE),(996400002,'SYNTHETIC-TITLE-2','합성비율','player',TRUE),(996400003,'SYNTHETIC-TITLE-3','합성범위','player',TRUE),(996400004,'SYNTHETIC-TITLE-4','합성롤백','player',TRUE)");
  await database.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped,display_order,acquisition_price) VALUES (?,996400001,UTC_TIMESTAMP(3),FALSE,1,9999),(?,996400002,UTC_TIMESTAMP(3),TRUE,2,20000),(?,996400003,UTC_TIMESTAMP(3),FALSE,3,0)", [player, player, player]);
}

async function run(eventId: string, message: string) {
  await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,external_user_id,external_identity_id,event_kind,processing_status,received_at) VALUES (?,'iris',?,?,?,'message','processing',UTC_TIMESTAMP(3))", [eventId, eventId, external, identity]);
  return new PlayerTitleSellService(db).handle({ eventId, externalUserId: external, destinationId: room, message });
}

async function counts() {
  return (await db.query<Array<{ titles: bigint; sales: bigint; line_count: bigint; ops: bigint; audits: bigint; outboxes: bigint; balance: string }>>(
    "SELECT (SELECT COUNT(*) FROM player_titles WHERE player_id=996100001) titles,(SELECT COUNT(*) FROM player_title_sale_operations) sales,(SELECT COUNT(*) FROM player_title_sale_lines) line_count,(SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'player.title.sell:%') ops,(SELECT COUNT(*) FROM command_audit a JOIN operations o ON o.id=a.operation_id WHERE o.idempotency_scope LIKE 'player.title.sell:%') audits,(SELECT COUNT(*) FROM outbox_messages m JOIN operations o ON o.id=m.operation_id WHERE o.idempotency_scope LIKE 'player.title.sell:%') outboxes,(SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=996100001 AND currency_code='point') balance"
  ))[0]!;
}

async function probe(): Promise<void> {
  await seed(db);
  const single = await run("title-single", "/타이틀판매 2");
  assert.equal(single?.status, "sold");
  assert.equal(single?.totalGain, "6000");
  assert.equal((await run("title-single", "/타이틀판매 2"))?.replayed, true);
  const rows = await db.query<Array<{ title_id: bigint; display_order: bigint; equipped: number }>>("SELECT title_id,display_order,equipped FROM player_titles WHERE player_id=? ORDER BY display_order", [player]);
  assert.deepEqual(rows.map((value) => [value.title_id, value.display_order, Number(value.equipped)]), [[996400001n, 1n, 0], [996400003n, 2n, 0]]);

  const range = await run("title-range", "/타이틀지정판매 1~99");
  assert.equal(range?.status, "sold");
  assert.equal(range?.soldCount, "2");
  assert.equal(range?.totalGain, "2000000");
  assert.equal((await run("title-missing", "/타이틀판매 1"))?.status, "not_found");

  await db.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped,display_order,acquisition_price) VALUES (?,996400004,UTC_TIMESTAMP(3),TRUE,1,0)", [player]);
  const before = await counts();
  await db.execute("CREATE TRIGGER synthetic_title_sale_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='title sale audit failure'");
  await assert.rejects(() => run("title-rollback", "/타이틀판매 1"), /title sale audit failure/);
  await db.execute("DROP TRIGGER synthetic_title_sale_audit_failure");
  assert.deepEqual(await counts(), before);
  assert.equal(await db.verifyRollback(), true);
  assert.equal((await run("title-after-rollback", "/타이틀판매 1"))?.status, "sold");
  const state = await counts();
  assert.deepEqual([state.titles,state.sales,state.line_count,state.ops,state.audits,state.outboxes,state.balance],[0n,3n,4n,4n,4n,4n,"3006000.000"]);
  process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 258, scenarios: ["single","range-partial","equipped","compact","replay","not-found","rollback","restart","shadow"], state }, (_key,value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

async function restart(): Promise<void> {
  const state = await counts();
  assert.deepEqual([state.titles,state.sales,state.line_count,state.ops,state.audits,state.outboxes,state.balance],[0n,3n,4n,4n,4n,4n,"3006000.000"]);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", state, additionalMutation: false, operationalDataTouched: false }, (_key,value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

function required(name: string): string { const value = process.env[name]; if (value === undefined || value === "") throw new Error(`${name} required`); return value; }
try { if (process.argv.includes("--verify-restart")) await restart(); else await probe(); } finally { await db.close(); }
