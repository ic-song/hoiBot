import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { OperationDailyResetCommandService } from "../src/admin/operation-daily-reset-command-service.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("operation daily reset command consumer MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let playerId: bigint;
  const suffix = Date.now().toString();
  const externalUserId = `daily-reset-operator-${suffix}`;
  const itemCodes = ["legacy_bag_ee475eca8a6543ef", "legacy_bag_8aa52459621254e1", "legacy_bag_c0feb66372020637"];
  const rooms = Array.from({ length: 10 }, (_, index) => `daily-reset-room-${index + 1}`);

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5_000 });
    const player = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    playerId = player.insertId;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'합성 회원')", [playerId]);
    const identity = await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')", [playerId, externalUserId]);
    const operator = await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','synthetic','active')", [`daily-reset-${suffix}`]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.insertId, identity.insertId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='super_admin'", [operator.insertId]);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=TRUE WHERE command_code='OPERATION_DAILY_RESET'");
  });

  after(async () => { if (database) await database.close(); });

  async function seedTemporaryItems(quantity: bigint): Promise<void> {
    for (const code of itemCodes) {
      await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,?,1 FROM item_definitions WHERE code=? ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),version=inventory_stacks.version+1", [playerId, quantity, code]);
    }
  }

  it("removes three canonical temporary stacks, queues eleven replies and replays without duplicate mutation", async () => {
    await seedTemporaryItems(2n);
    const service = new OperationDailyResetCommandService(database, rooms);
    const eventId = `daily-reset-consumer-${suffix}`;
    const result = await service.execute({ eventId, externalUserId, channelId: "request-room", message: "/리셋" });
    assert.equal(result?.status, "changed");
    assert.equal(result?.removedTemporaryItemQuantity, "6");
    assert.equal(result?.replies.length, 11);
    const remaining = (await database.query<Array<{ quantity: string }>>("SELECT COALESCE(SUM(stack.quantity),0) quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code IN (?,?,?)", [playerId, ...itemCodes]))[0]!;
    assert.equal(BigInt(remaining.quantity), 0n);
    const ledger = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM inventory_ledger WHERE operation_id=? AND quantity_delta=-2", [result!.operationId]))[0]!;
    assert.equal(Number(ledger.count), 3);
    const outbox = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE operation_id=? AND provider_code='iris'", [result!.operationId]))[0]!;
    assert.equal(Number(outbox.count), 11);
    const replay = await service.execute({ eventId, externalUserId, channelId: "request-room", message: "/리셋" });
    assert.equal(replay?.replayed, true);
    const outboxAfter = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM outbox_messages WHERE operation_id=?", [result!.operationId]))[0]!;
    assert.equal(Number(outboxAfter.count), 11);
  });

  it("rolls back item and outbox work on consumer audit failure, then resumes over the replayed provider", async () => {
    await seedTemporaryItems(1n);
    await database.execute(`CREATE TRIGGER fail_daily_reset_consumer_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='operation.daily_reset' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic audit failure'; END IF; END`);
    const service = new OperationDailyResetCommandService(database, rooms);
    const eventId = `daily-reset-recovery-${suffix}`;
    await assert.rejects(() => service.execute({ eventId, externalUserId, channelId: "request-room", message: "/리셋" }), /synthetic audit failure/);
    const remaining = (await database.query<Array<{ quantity: string }>>("SELECT COALESCE(SUM(stack.quantity),0) quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code IN (?,?,?)", [playerId, ...itemCodes]))[0]!;
    assert.equal(BigInt(remaining.quantity), 3n);
    const pendingConsumer = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM operations WHERE idempotency_scope='operation.daily_reset.command' AND idempotency_key=?", [eventId]))[0]!;
    assert.equal(Number(pendingConsumer.count), 0);
    await database.execute("DROP TRIGGER fail_daily_reset_consumer_audit");
    const recovered = await service.execute({ eventId, externalUserId, channelId: "request-room", message: "/리셋" });
    assert.equal(recovered?.status, "changed");
    assert.equal(recovered?.removedTemporaryItemQuantity, "3");
  });
});
