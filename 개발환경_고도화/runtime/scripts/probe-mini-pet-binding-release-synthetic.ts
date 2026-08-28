import assert from "node:assert/strict";
import { MiniPetBindingReleaseService } from "../src/mini-pet/mini-pet-binding-release-service.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const databaseName = required("DATABASE_NAME");
assert.match(databaseName, /^hoibot_admin_binding_release(?:_[a-z0-9_]+)?$/i, "격리 귀속 해제 DB만 사용할 수 있습니다.");
const db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: databaseName, connectionLimit: 12, connectTimeoutMs: 5000 });
const room = "고도화귀속해제방";
const players = [341001n, 341002n, 341003n, 341004n, 341005n, 341006n];
const users = ["binding-main", "binding-empty", "binding-no-ticket", "binding-premium", "binding-concurrent", "binding-rollback"];
interface State { releaseOps: bigint; ticketLedgers: bigint; operations: bigint; executions: bigint; audits: bigint; outboxes: bigint; equipped: bigint; bag: bigint; tickets: bigint }

async function insertRows(prefix: string, columns: number, rows: readonly (readonly unknown[])[]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += 100) {
    const chunk = rows.slice(offset, offset + 100);
    await db.execute(`${prefix} VALUES ${chunk.map(() => `(${Array.from({ length: columns }, () => "?").join(",")})`).join(",")}`, chunk.flat());
  }
}
async function seedIdentity(): Promise<void> {
  await insertRows("INSERT INTO players(id,status,version)", 3, players.map((id) => [id, "active", 1]));
  await insertRows("INSERT INTO player_profiles(player_id,current_display_name,version)", 3, players.map((id, index) => [id, `귀속회원${index + 1}`, 1]));
  await insertRows("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status)", 6, players.map((id, index) => [342000n + id, id, "kakao", users[index], `귀속회원${index + 1}`, "linked"]));
}
async function definition(): Promise<bigint> {
  const result = await db.execute("INSERT INTO mini_pet_definitions(code,display_name,grade_code,grade_display_name,emoji_value,active) VALUES('SYNTHETIC-BINDING-PET','합성 귀속펫','normal','일반','🐰',TRUE)");
  return result.insertId;
}
async function addPet(playerId: bigint, definitionId: bigint, equipped: boolean, sequence: bigint | null): Promise<bigint> {
  return (await db.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,enhancement_level,battle_experience,castle_experience,raid_experience,bag_sequence,version,equipped) VALUES (?,?,0,0,10,20,30,?,1,?)", [playerId, definitionId, sequence, equipped])).insertId;
}
async function ticket(playerId: bigint, quantity: bigint): Promise<void> { await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,?,1 FROM item_definitions WHERE code='ITEM-MINI-PET-UNBIND-TICKET'", [playerId, quantity]); }
async function event(suffix: string, playerIndex: number): Promise<string> {
  const eventId = `binding-${suffix}`;
  await db.execute("INSERT IGNORE INTO event_inbox(event_id,provider_code,provider_event_id,external_user_id,external_identity_id,event_kind,processing_status,received_at) VALUES(?,'iris',?,?,?,'message','processing',UTC_TIMESTAMP(3))", [eventId, eventId, users[playerIndex], 342000n + players[playerIndex]!]);
  return eventId;
}
async function run(suffix: string, playerIndex: number) { return new MiniPetBindingReleaseService(db).handle({ eventId: await event(suffix, playerIndex), externalUserId: users[playerIndex]!, channelId: room, message: "/귀속해제" }); }
async function state(): Promise<State> {
  const row = (await db.query<Array<Record<keyof State, bigint | string>>>(`SELECT
    (SELECT COUNT(*) FROM mini_pet_binding_release_operations) releaseOps,
    (SELECT COUNT(*) FROM inventory_ledger WHERE reason_code='MINI_PET_BINDING_RELEASE_TICKET') ticketLedgers,
    (SELECT COUNT(*) FROM operations WHERE idempotency_scope='mini_pet.binding_release') operations,
    (SELECT COUNT(*) FROM command_executions WHERE command_code='MINI_PET_BINDING_RELEASE') executions,
    (SELECT COUNT(*) FROM command_audit WHERE action_code='mini_pet.binding_release') audits,
    (SELECT COUNT(*) FROM outbox_messages outbox_row JOIN operations operation_row ON operation_row.id=outbox_row.operation_id WHERE operation_row.idempotency_scope='mini_pet.binding_release') outboxes,
    (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id BETWEEN 341001 AND 341006 AND equipped=TRUE) equipped,
    (SELECT COUNT(*) FROM owned_mini_pets WHERE player_id BETWEEN 341001 AND 341006 AND equipped=FALSE) bag,
    (SELECT COALESCE(SUM(stack.quantity),0) FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE item.code='ITEM-MINI-PET-UNBIND-TICKET' AND stack.player_id BETWEEN 341001 AND 341006) tickets`))[0]!;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, BigInt(value)])) as unknown as State;
}

async function probe(): Promise<void> {
  const registry = (await db.query<Array<{ rollout_state: string; aliases: bigint; base_limit: bigint; premium_bonus: bigint }>>("SELECT registry.rollout_state,(SELECT COUNT(*) FROM command_aliases WHERE command_code='MINI_PET_BINDING_RELEASE' AND command_text='/귀속해제' AND active=TRUE) aliases,(SELECT base_bag_limit FROM mini_pet_binding_release_policy WHERE policy_key='default') base_limit,(SELECT premium_bag_bonus FROM mini_pet_binding_release_policy WHERE policy_key='default') premium_bonus FROM command_registry registry WHERE registry.command_code='MINI_PET_BINDING_RELEASE'"))[0]!;
  assert.deepEqual([registry.rollout_state, registry.aliases, registry.base_limit, registry.premium_bonus], ["SHADOW", 1n, 10n, 5n]);
  await seedIdentity();
  const petDefinition = await definition();

  await ticket(players[1]!, 1n);
  assert.equal((await run("empty", 1)).status, "rejected");
  await addPet(players[2]!, petDefinition, true, null);
  assert.match((await run("no-ticket", 2)).reply, /아이템이 부족합니다/);

  await addPet(players[0]!, petDefinition, true, null);
  for (let index = 1; index <= 10; index += 1) await addPet(players[0]!, petDefinition, false, BigInt(index));
  await ticket(players[0]!, 2n);
  assert.match((await run("full", 0)).reply, /가방이 가득 찼습니다/);
  await db.execute("DELETE FROM owned_mini_pets WHERE player_id=? AND equipped=FALSE AND bag_sequence=10", [players[0]]);
  const mainEvent = await event("success", 0);
  const main = await new MiniPetBindingReleaseService(db).handle({ eventId: mainEvent, externalUserId: users[0]!, channelId: room, message: "/귀속해제" });
  assert.deepEqual([main.status, main.bagCount, main.bagLimit], ["released", "10", "10"]);
  assert.deepEqual(await new MiniPetBindingReleaseService(db).handle({ eventId: mainEvent, externalUserId: users[0]!, channelId: room, message: "/귀속해제" }), main);

  await addPet(players[3]!, petDefinition, true, null);
  for (let index = 1; index <= 14; index += 1) await addPet(players[3]!, petDefinition, false, BigInt(index));
  await ticket(players[3]!, 1n);
  await db.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,'premium',TRUE,TRUE)", [players[3]]);
  const premium = await run("premium", 3);
  assert.deepEqual([premium.status, premium.bagCount, premium.bagLimit], ["released", "15", "15"]);

  await addPet(players[4]!, petDefinition, true, null);
  await ticket(players[4]!, 2n);
  const concurrent = await Promise.all([run("concurrent-a", 4), run("concurrent-b", 4)]);
  assert.equal(concurrent.filter((result) => result.status === "released").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);

  await addPet(players[5]!, petDefinition, true, null);
  await ticket(players[5]!, 2n);
  const beforeRollback = await state();
  await db.execute("CREATE TRIGGER synthetic_binding_release_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='binding release probe failure'");
  await assert.rejects(() => run("rollback", 5), /binding release probe failure/);
  await db.execute("DROP TRIGGER synthetic_binding_release_failure");
  assert.deepEqual(await state(), beforeRollback);
  assert.equal(await db.verifyRollback(), true);
  assert.equal((await run("rollback", 5)).status, "released");

  const current = await state();
  assert.deepEqual(current, { releaseOps: 4n, ticketLedgers: 4n, operations: 8n, executions: 8n, audits: 8n, outboxes: 8n, equipped: 1n, bag: 27n, tickets: 4n });
  process.stdout.write(JSON.stringify({ mode: "probe", migration: "341_mini_pet_binding_release.sql", scenarios: ["shadow", "exact-command", "no-equipped", "ticket-insufficient", "base-capacity", "premium-capacity", "stable-equipped-to-bag", "ticket-ledger", "idempotent-replay", "concurrent-single-release", "rollback", "retry"], state: current, main }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

async function restart(): Promise<void> {
  const before = await state();
  const replay = await new MiniPetBindingReleaseService(db).handle({ eventId: "binding-success", externalUserId: users[0]!, channelId: room, message: "/귀속해제" });
  assert.deepEqual([replay.status, replay.bagCount, replay.bagLimit], ["released", "10", "10"]);
  assert.deepEqual(await state(), before);
  process.stdout.write(JSON.stringify({ mode: "verify-restart", replay, state: before, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
}

function required(name: string): string { const value = process.env[name]; if (value === undefined || value === "") throw new Error(`${name} required`); return value; }
try { if (process.argv.includes("--verify-restart")) await restart(); else await probe(); } finally { await db.close(); }
