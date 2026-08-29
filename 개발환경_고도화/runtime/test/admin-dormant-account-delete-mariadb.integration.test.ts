import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { AdminDormantAccountDeleteService } from "../src/admin/admin-dormant-account-delete-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const enabled = process.env.ADMIN_DORMANT_ACCOUNT_DELETE_MARIADB_TEST === "true";
const database = enabled ? createDatabaseClient(loadConfig().database) : null;
const service = database === null ? null : new AdminDormantAccountDeleteService(database);
after(async () => { if (database !== null) await database.close(); });

describe("admin dormant account delete MariaDB", { skip: !enabled }, () => {
  it("lists the exact boundary and deletes only the eligible account", async () => {
    assert.ok(database !== null && service !== null);
    await database.execute("INSERT INTO players(id,status) VALUES (9900003481,'active'),(9900003482,'active'),(9900003483,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,level,terms_agreed,updated_at) VALUES (9900003481,'잠수운영자',999,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 10 DAY)),(9900003482,'잠수대상',10,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 6 DAY)),(9900003483,'활동대상',10,TRUE,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 4 DAY))");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (9900003481,9900003481,'kakao','dormant-operator','잠수운영자','linked'),(9900003482,9900003482,'kakao','dormant-target','잠수대상','linked'),(9900003483,9900003483,'kakao','active-target','활동대상','linked')");
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (9900003481,'dormantop','잠수운영자','x','active')");
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (9900003481,9900003481)");
    await database.execute("INSERT INTO admin_operator_permission_overrides(operator_id,permission_code,effect,granted_by,reason) VALUES (9900003481,'account.delete','allow',9900003481,'synthetic')");
    await database.execute("INSERT INTO event_inbox(event_id,event_kind,payload_hash,processing_status,received_at) VALUES ('dormant-list','message',REPEAT('a',64),'received',UTC_TIMESTAMP(3)),('dormant-delete','message',REPEAT('b',64),'received',UTC_TIMESTAMP(3))");
    const listed = await service.execute({ eventId: "dormant-list", externalUserId: "dormant-operator", destinationId: "isolated-dormant-room", message: "/계정잠수명단 10" });
    const deleted = await service.execute({ eventId: "dormant-delete", externalUserId: "dormant-operator", destinationId: "isolated-dormant-room", message: "/계정잠수삭제 10" });
    assert.deepEqual(listed.candidatePlayerIds, ["9900003482"]);
    assert.deepEqual(deleted.deletedPlayerIds, ["9900003482"]);
    assert.equal((await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM players WHERE id=9900003482 AND status='deleted'"))[0]!.value, 1n);
    assert.equal((await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM players WHERE id=9900003483 AND status='active'"))[0]!.value, 1n);
  });
});
