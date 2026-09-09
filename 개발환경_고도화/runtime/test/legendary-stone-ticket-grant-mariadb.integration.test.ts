import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { LegendaryStoneTicketGrantService } from "../src/admin/legendary-stone-ticket-grant-service.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

async function waitForReplies(replies: Array<{ room: string; data: string }>, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length >= count, true, "Iris reply was not delivered within 5 seconds");
}

describe("legendary stone ticket grant MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let targetPlayerId: bigint;
  const suffix = Date.now().toString();
  const token = "legendary-ticket-token";
  const roomId = "990000000000325";
  const operatorExternalId = `legendary-ticket-admin-${suffix}`;
  const unauthorizedExternalId = `legendary-ticket-user-${suffix}`;
  const targetName = `합성 전돌 회원 ${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_LEGENDARY_STONE_TICKET_GRANT'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`legendary-ticket-admin-${suffix}`, "합성 전돌 관리자", "synthetic"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`legendary-ticket-admin-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);

    for (const [externalId, displayName, linkedOperator] of [[operatorExternalId, "합성 전돌 관리자", true], [unauthorizedExternalId, "권한 없는 회원", false]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
      if (linkedOperator) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      }
    }

    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    targetPlayerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [targetPlayerId, targetName]);
  });

  after(async () => {
    if (database) {
      try { await database.close(); }
      catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
        if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
      }
    }
  });

  it("grants atomically, denies unauthorized requests, shadows without mutation, rolls back and replays", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "legendary-ticket-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (id: string, externalId: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화팻테스트방", sender: externalId, json: { _id: id, chat_id: roomId, user_id: externalId } } });
    const quantity = async (): Promise<bigint> => (await database.query<Array<{ quantity: bigint }>>(`SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-LEGENDARY-STONE-DRAW-TICKET'`, [targetPlayerId]))[0]?.quantity ?? 0n;

    const successEvent = `legendary-ticket-success-${suffix}`;
    const canonicalSuccessEvent = `iris:${successEvent}`;
    assert.equal((await send(successEvent, operatorExternalId, `/전돌2, ${targetName}`)).statusCode, 202);
    await waitForReplies(replies, 1);
    assert.equal(replies.at(-1)!.data, `${targetName}님에게 전설의돌 뽑기🩶[2](/전돌뽑기 숫자) 2개를 지급했습니다.`);
    assert.equal(await quantity(), 2n);
    const replay = await new LegendaryStoneTicketGrantService(database).grant({ eventId: canonicalSuccessEvent, destinationId: roomId, externalUserId: operatorExternalId, message: `/전돌2, ${targetName}` });
    assert.equal(replay?.status, "granted");
    assert.equal(await quantity(), 2n);

    const beforeUnauthorized = replies.length;
    await send(`legendary-ticket-denied-${suffix}`, unauthorizedExternalId, `/전돌3, ${targetName}`);
    assert.equal(replies.length, beforeUnauthorized);
    assert.equal(await quantity(), 2n);

    await send(`legendary-ticket-missing-${suffix}`, operatorExternalId, `/전돌3, 존재하지 않는 회원 ${suffix}`);
    await waitForReplies(replies, beforeUnauthorized + 1);
    assert.match(replies.at(-1)!.data, /유저 아이디를 확인/);
    assert.equal(await quantity(), 2n);

    await send(`legendary-ticket-zero-${suffix}`, operatorExternalId, `/전돌0, ${targetName}`);
    await waitForReplies(replies, beforeUnauthorized + 2);
    assert.match(replies.at(-1)!.data, /1개 이상/);
    assert.equal(await quantity(), 2n);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_LEGENDARY_STONE_TICKET_GRANT'");
    const beforeShadow = replies.length;
    await send(`legendary-ticket-shadow-${suffix}`, operatorExternalId, `/전돌4, ${targetName}`);
    assert.equal(replies.length, beforeShadow);
    assert.equal(await quantity(), 2n);
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_LEGENDARY_STONE_TICKET_GRANT'");

    const rollbackEvent = `iris:legendary-ticket-rollback-${suffix}`;
    await database.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'command','processed',UTC_TIMESTAMP(3))", [rollbackEvent]);
    await database.execute("CREATE TRIGGER synthetic_legendary_ticket_audit_failure BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic legendary ticket rollback'");
    await assert.rejects(new LegendaryStoneTicketGrantService(database).grant({ eventId: rollbackEvent, destinationId: roomId, externalUserId: operatorExternalId, message: `/전돌5, ${targetName}` }), /synthetic legendary ticket rollback/);
    await database.execute("DROP TRIGGER synthetic_legendary_ticket_audit_failure");
    assert.equal(await quantity(), 2n);

    const concurrentEvent = `iris:legendary-ticket-concurrent-${suffix}`;
    await database.execute("INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'command','processed',UTC_TIMESTAMP(3))", [concurrentEvent]);
    const concurrentService = new LegendaryStoneTicketGrantService(database);
    const concurrentInput = { eventId: concurrentEvent, destinationId: roomId, externalUserId: operatorExternalId, message: `/전돌6, ${targetName}` };
    const [concurrentFirst, concurrentSecond] = await Promise.all([concurrentService.grant(concurrentInput), concurrentService.grant(concurrentInput)]);
    assert.deepEqual(concurrentSecond, concurrentFirst);
    assert.equal(await quantity(), 8n);

    const evidence = (await database.query<Array<{ ledger_count: bigint; audit_count: bigint; execution_count: bigint; outbox_count: bigint }>>(`SELECT
      (SELECT COUNT(*) FROM inventory_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope='admin.legendary_stone_ticket.grant' AND operation.idempotency_key=?) ledger_count,
      (SELECT COUNT(*) FROM command_audit audit JOIN operations operation ON operation.id=audit.operation_id WHERE operation.idempotency_scope='admin.legendary_stone_ticket.grant' AND operation.idempotency_key=?) audit_count,
      (SELECT COUNT(*) FROM command_executions WHERE event_id=? AND command_code='ADMIN_LEGENDARY_STONE_TICKET_GRANT') execution_count,
      (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id WHERE operation.idempotency_scope='admin.legendary_stone_ticket.grant' AND operation.idempotency_key=?) outbox_count`, [canonicalSuccessEvent, canonicalSuccessEvent, canonicalSuccessEvent, canonicalSuccessEvent]))[0]!;
    assert.deepEqual([Number(evidence.ledger_count), Number(evidence.audit_count), Number(evidence.execution_count), Number(evidence.outbox_count)], [1, 1, 1, 1]);
    await app.close();
  });
});
