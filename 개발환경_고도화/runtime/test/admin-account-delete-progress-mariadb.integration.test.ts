import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { AdminAccountDeleteProgressService } from "../src/admin/admin-account-delete-progress-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const enabled = process.env.ADMIN_ACCOUNT_DELETE_PROGRESS_MARIADB_TEST === "true";
const database = enabled ? createDatabaseClient(loadConfig().database) : null;
const service = database === null ? null : new AdminAccountDeleteProgressService(database);
after(async () => { if (database !== null) await database.close(); });

describe("admin account delete progress MariaDB", { skip: !enabled }, () => {
  it("anonymizes one target, reports a missing target and replays once", async () => {
    assert.ok(database !== null && service !== null);
    await database.execute("INSERT INTO players(id,status) VALUES (9900003471,'active'),(9900003472,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,terms_agreed) VALUES (9900003471,'삭제운영자',TRUE),(9900003472,'삭제대상',TRUE)");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (9900003471,9900003471,'kakao','account-delete-operator','삭제운영자','linked'),(9900003472,9900003472,'kakao','account-delete-target','삭제대상','linked')");
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (9900003471,'deleteop','삭제운영자','x','active')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (9900003471,9900003471)");
    await database.execute("INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason) VALUES (9900003471,'account.delete','allow',9900003471,'synthetic')");
    await database.execute("INSERT INTO event_inbox(event_id,event_kind,payload_hash,processing_status,received_at) VALUES ('account-delete-integration','message',REPEAT('a',64),'received',UTC_TIMESTAMP(3))");
    const first = await service.execute({ eventId: "account-delete-integration", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제대상, 없는대상" });
    const replay = await service.execute({ eventId: "account-delete-integration", externalUserId: "account-delete-operator", destinationId: "isolated-account-delete-room", message: "/계삭진행 삭제대상, 없는대상" });
    assert.equal(first.resultCode, "partial_success");
    assert.deepEqual(first.failures, [{ name: "없는대상", code: "not_found" }]);
    assert.equal(replay.replayed, true);
    assert.equal((await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM players WHERE id=9900003472 AND status='deleted' AND deleted_at IS NOT NULL"))[0]!.value, 1n);
    assert.equal((await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='admin.account_delete_progress'"))[0]!.value, 1n);
  });
});
