import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const loginId = process.argv[2];
const externalUserId = process.env.HOIBOT_ADMIN_KAKAO_USER_ID;
if (loginId === undefined || externalUserId === undefined || externalUserId.trim() === "") {
  throw new Error("Pass <loginId> and set HOIBOT_ADMIN_KAKAO_USER_ID for this one-time operation.");
}
const database = createDatabaseClient(loadConfig().database);
try {
  const result = await database.execute(
    `INSERT INTO admin_operator_external_identities (operator_id, external_identity_id, created_at)
     SELECT operator.id, identity.id, UTC_TIMESTAMP(3)
     FROM admin_operators operator JOIN external_identities identity
     WHERE operator.login_id = ? AND identity.provider_code = 'kakao' AND identity.external_user_id = ?
       AND identity.status = 'linked'`,
    [loginId, externalUserId]
  );
  if (result.affectedRows !== 1n) throw new Error("An active linked identity and operator are required.");
  process.stdout.write("admin-iris-identity-linked\n");
} finally {
  await database.close();
}
