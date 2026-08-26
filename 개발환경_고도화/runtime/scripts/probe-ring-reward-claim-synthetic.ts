import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { RingRewardClaimService } from "../src/ring/ring-reward-claim-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_ring_reward(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic ring reward probe is blocked for database: ${config.database.name}`);
}

const verifyRestart = process.argv.includes("--verify-restart");
const baseEventId = process.env.RING_REWARD_PROBE_EVENT_ID
  ?? `ring-reward-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
if (verifyRestart && process.env.RING_REWARD_PROBE_EVENT_ID === undefined) {
  throw new Error("RING_REWARD_PROBE_EVENT_ID is required with --verify-restart.");
}

const database = createDatabaseClient(config.database);
const service = new RingRewardClaimService(database);
const players = {
  normal: "910000001", missingPet: "910000002", missingRing: "910000003",
  emptyReward: "910000004", rollback: "910000005"
} as const;

// command_executions 외래 키를 만족하는 비식별 합성 이벤트를 준비합니다.
async function seedEvent(eventId: string, externalUserId: string): Promise<void> {
  await database.execute(
    `INSERT INTO event_inbox
      (event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at)
     VALUES (?,?,'synthetic-ring-room',?,'message','incoming',REPEAT('8',64),'processed',UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)`,
    [eventId, eventId, externalUserId]
  );
}

// 감사 기록 직전 실패를 주입해 보상 transaction 전체 rollback을 검증합니다.
function failingOnAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, params) => inner.query(sql, params),
    execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) =>
      inner.withTransaction((transaction) => work({
        query: (sql, params) => transaction.query(sql, params),
        execute: async (sql, params) => {
          if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic ring reward audit failure");
          return transaction.execute(sql, params);
        }
      }))
  };
}

// 합성 player, identity, pet과 레거시 반지 snapshot만 격리 DB에 준비합니다.
async function seedFixtures(): Promise<void> {
  for (const playerId of Object.values(players)) {
    await database.execute("INSERT INTO players(id,status) VALUES (?,'active') ON DUPLICATE KEY UPDATE status='active'", [playerId]);
  }
  const identities = [
    ["920000001", players.normal, "synthetic-ring-normal"],
    ["920000002", players.missingPet, "synthetic-ring-missing-pet"],
    ["920000003", players.missingRing, "synthetic-ring-missing-ring"],
    ["920000004", players.emptyReward, "synthetic-ring-empty"],
    ["920000005", players.rollback, "synthetic-ring-rollback"]
  ];
  for (const [identityId, playerId, externalUserId] of identities) {
    await database.execute(
      `INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status)
       VALUES (?,?,'kakao',?,'합성 사용자','linked')
       ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),status='linked'`,
      [identityId, playerId, externalUserId]
    );
  }
  for (const playerId of [players.normal, players.missingRing, players.emptyReward, players.rollback]) {
    await database.execute(
      "INSERT INTO player_pets(player_id,display_name) VALUES (?,'합성펫') ON DUPLICATE KEY UPDATE display_name='합성펫'",
      [playerId]
    );
  }
  const snapshots = [
    [players.normal, "합성반지", "전설", 7, 1200, 800],
    [players.missingPet, "펫없는반지", "희귀", 2, 10, 20],
    [players.emptyReward, "빈반지", "일반", 0, 0, 0],
    [players.rollback, "롤백반지", "영웅", 5, 300, 200]
  ];
  for (const row of snapshots) {
    await database.execute(
      `INSERT INTO player_legacy_ring_reward_snapshots
        (player_id,ring_name,ring_grade,enhancement_level,raid_charm,castle_charm,claim_status,source_version)
       VALUES (?,?,?,?,?,?,'pending','synthetic-ver-2.400')
       ON DUPLICATE KEY UPDATE ring_name=VALUES(ring_name),ring_grade=VALUES(ring_grade),enhancement_level=VALUES(enhancement_level),
         raid_charm=VALUES(raid_charm),castle_charm=VALUES(castle_charm)`,
      row
    );
  }
}

// 직접 service 호출에 필요한 공통 입력을 구성합니다.
function claimInput(playerId: string, identityId: string, eventId: string) {
  return { playerId, identityId, destinationId: "synthetic-ring-room", sourceEventId: eventId, idempotencyKey: eventId };
}

try {
  const normalEventId = `${baseEventId}-normal`;
  const normalScope = `ring.reward_claim:${players.normal}`;
  if (verifyRestart) {
    const before = await database.query<Array<{ quantity: bigint; version: bigint }>>(
      `SELECT stack.quantity,stack.version FROM inventory_stacks stack
       JOIN item_definitions item ON item.id=stack.item_id
       WHERE stack.player_id=? AND item.code='ITEM-RING-CHARM-REWARD'`, [players.normal]
    );
    const replay = await service.claim(claimInput(players.normal, "920000001", normalEventId));
    const after = await database.query<Array<{ quantity: bigint; version: bigint }>>(
      `SELECT stack.quantity,stack.version FROM inventory_stacks stack
       JOIN item_definitions item ON item.id=stack.item_id
       WHERE stack.player_id=? AND item.code='ITEM-RING-CHARM-REWARD'`, [players.normal]
    );
    assert.deepEqual(after, before);
    assert.equal(replay.status, "claimed");
    const operationCount = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) AS count FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [normalScope, normalEventId]
    );
    assert.equal(operationCount[0]?.count, 1n);
    process.stdout.write(`${JSON.stringify({ mode: "verify-restart", database: config.database.name, baseEventId,
      operationCount: 1, inventoryQuantity: Number(after[0]?.quantity), additionalGrant: false, operationalDataTouched: false })}\n`);
  } else {
    await seedFixtures();
    const shadowEventId = `${baseEventId}-shadow`;
    const shadow = await service.handleIris({ externalUserId: "synthetic-ring-normal", channelId: "synthetic-ring-room", message: "/반지보상받기", eventId: shadowEventId });
    assert.equal(shadow.status, "shadow");
    const shadowState = await database.query<Array<{ claim_status: string; inventory: bigint }>>(
      `SELECT snapshot.claim_status,
        (SELECT COUNT(*) FROM inventory_stacks WHERE player_id=snapshot.player_id) AS inventory
       FROM player_legacy_ring_reward_snapshots snapshot WHERE snapshot.player_id=?`, [players.normal]
    );
    assert.deepEqual(shadowState[0], { claim_status: "pending", inventory: 0n });

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='RING_REWARD_CLAIM'");
    await seedEvent(normalEventId, "synthetic-ring-normal");
    const normal = await service.handleIris({ externalUserId: "synthetic-ring-normal", channelId: "synthetic-ring-room", message: "/반지보상받기", eventId: normalEventId });
    assert.equal(normal.status, "changed");
    assert.match(normal.data, /x2,000/);
    const granted = await database.query<Array<{ quantity: bigint; claim_status: string; ledger: bigint }>>(
      `SELECT stack.quantity,snapshot.claim_status,
        (SELECT COUNT(*) FROM inventory_ledger ledger WHERE ledger.player_id=stack.player_id AND ledger.reason_code='RING_REWARD_CLAIM') AS ledger
       FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
       JOIN player_legacy_ring_reward_snapshots snapshot ON snapshot.player_id=stack.player_id
       WHERE stack.player_id=? AND item.code='ITEM-RING-CHARM-REWARD'`, [players.normal]
    );
    assert.deepEqual(granted[0], { quantity: 2000n, claim_status: "claimed", ledger: 1n });

    const replay = await service.handleIris({ externalUserId: "synthetic-ring-normal", channelId: "synthetic-ring-room", message: "/반지보상받기", eventId: normalEventId });
    assert.deepEqual(replay, normal);
    const replayCount = await database.query<Array<{ operations: bigint; quantity: bigint; ledger: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope=? AND idempotency_key=?) AS operations,
        (SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-RING-CHARM-REWARD') AS quantity,
        (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=? AND reason_code='RING_REWARD_CLAIM') AS ledger`,
      [normalScope, normalEventId, players.normal, players.normal]
    );
    assert.deepEqual(replayCount[0], { operations: 1n, quantity: 2000n, ledger: 1n });

    const cases = [
      ["claimed", players.normal, "920000001", "already_claimed"],
      ["missing-pet", players.missingPet, "920000002", "missing_pet"],
      ["missing-ring", players.missingRing, "920000003", "missing_ring"],
      ["empty", players.emptyReward, "920000004", "empty_reward"]
    ] as const;
    for (const [suffix, playerId, identityId, expected] of cases) {
      const eventId = `${baseEventId}-${suffix}`;
      await seedEvent(eventId, `synthetic-ring-${suffix}`);
      const result = await service.claim(claimInput(playerId, identityId, eventId));
      assert.equal(result.status, expected);
    }

    const failureEventId = `${baseEventId}-failure`;
    await seedEvent(failureEventId, "synthetic-ring-rollback");
    await assert.rejects(
      () => new RingRewardClaimService(failingOnAudit(database)).claim(claimInput(players.rollback, "920000005", failureEventId)),
      /synthetic ring reward audit failure/
    );
    const rollback = await database.query<Array<{ claim_status: string; inventory: bigint; operations: bigint; executions: bigint; outboxes: bigint }>>(
      `SELECT snapshot.claim_status,
        (SELECT COUNT(*) FROM inventory_stacks WHERE player_id=snapshot.player_id) AS inventory,
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope=? AND idempotency_key=?) AS operations,
        (SELECT COUNT(*) FROM command_executions WHERE event_id=?) AS executions,
        (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id
          WHERE operation_row.idempotency_scope=? AND operation_row.idempotency_key=?) AS outboxes
       FROM player_legacy_ring_reward_snapshots snapshot WHERE snapshot.player_id=?`,
      [`ring.reward_claim:${players.rollback}`, failureEventId, failureEventId,
        `ring.reward_claim:${players.rollback}`, failureEventId, players.rollback]
    );
    assert.deepEqual(rollback[0], { claim_status: "pending", inventory: 0n, operations: 0n, executions: 0n, outboxes: 0n });
    assert.equal(await database.verifyRollback(), true);

    process.stdout.write(`${JSON.stringify({ mode: "probe", database: config.database.name, baseEventId,
      migrationCount: 108, scenarios: ["shadow", "active-claim", "event-replay", "already-claimed", "missing-pet", "missing-ring", "empty-reward", "mid-write-rollback"],
      rewardQuantity: 2000, operationCount: 1, ledgerCount: 1, rollbackEffects: { operation: 0, execution: 0, outbox: 0, inventory: 0 },
      transactionRollback: true, operationalDataTouched: false })}\n`);
  }
} finally {
  await database.close();
}
