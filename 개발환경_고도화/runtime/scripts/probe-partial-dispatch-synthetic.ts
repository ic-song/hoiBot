import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { GetMyProfileService } from "../src/player/get-my-profile-service.js";
import { MariaProfileRepository } from "../src/player/maria-profile-repository.js";

const EVENT_ID = "synthetic-partial-dispatch-20260824";

async function run(): Promise<void> {
  const config = loadConfig();
  const database = createDatabaseClient(config.database);
  try {
    await database.execute("DELETE FROM command_routing_decisions WHERE event_id = ?", [EVENT_ID]);
    const dispatcher = new CommandDispatcher(new MariaCommandDispatchRepository(database), {
      enabled: true, allowAllCanaries: true, canaryUserIds: new Set()
    });
    const profile = await dispatcher.resolve({
      eventId: EVENT_ID, message: "/내정보", userId: "synthetic-user", hasTrustedDisplayName: true
    });
    assert.equal(profile.route, "MODERN");
    assert.equal(profile.handlerKey, "USER_PROFILE");

    const suffix = await dispatcher.resolve({
      message: "/내정보 추가문자", userId: "synthetic-user", hasTrustedDisplayName: true
    });
    assert.equal(suffix.route, "LEGACY_FALLBACK");
    await dispatcher.resolve({
      eventId: EVENT_ID, message: "/내정보", userId: "synthetic-user", hasTrustedDisplayName: true
    });
    const rows = await database.query<Array<{ decision_count: number }>>(
      "SELECT COUNT(*) AS decision_count FROM command_routing_decisions WHERE event_id = ?", [EVENT_ID]
    );
    assert.equal(Number(rows[0]?.decision_count), 1);

    const identities = await database.query<Array<{
      provider_code: string;
      external_user_id: string;
      player_id: bigint;
    }>>(
      `SELECT provider_code, external_user_id, player_id
         FROM external_identities
        WHERE player_id IS NOT NULL
        ORDER BY id
        LIMIT 1`
    );
    const identity = identities[0];
    assert.ok(identity);
    const profileResult = await new GetMyProfileService(new MariaProfileRepository(database))
      .execute(identity.provider_code, identity.external_user_id);
    assert.equal(profileResult.playerId, identity.player_id.toString());

    await database.execute(
      "UPDATE command_registry SET rollout_state = 'SHADOW' WHERE command_code = 'USER_PROFILE_MY_INFO'"
    );
    try {
      const shadow = await dispatcher.resolve({
        message: "/내정보", userId: "synthetic-user", hasTrustedDisplayName: true
      });
      assert.equal(shadow.route, "SHADOW");
    } finally {
      await database.execute(
        "UPDATE command_registry SET rollout_state = 'CANARY' WHERE command_code = 'USER_PROFILE_MY_INFO'"
      );
    }

    const rollbackEventId = `${EVENT_ID}-rollback`;
    await database.execute("DELETE FROM command_routing_decisions WHERE event_id = ?", [rollbackEventId]);
    await assert.rejects(
      database.withTransaction(async (transaction) => {
        await transaction.execute(
          `INSERT INTO command_routing_decisions
             (event_id, message_hash, command_code, route, reason_code)
           VALUES (?, REPEAT('1', 64), 'USER_PROFILE_MY_INFO', 'MODERN', 'ROLLBACK_PROBE')`,
          [rollbackEventId]
        );
        throw new Error("synthetic rollback");
      }),
      /synthetic rollback/
    );
    const rollbackRows = await database.query<Array<{ decision_count: number }>>(
      "SELECT COUNT(*) AS decision_count FROM command_routing_decisions WHERE event_id = ?",
      [rollbackEventId]
    );
    assert.equal(Number(rollbackRows[0]?.decision_count), 0);
  } finally {
    await database.execute("DELETE FROM command_routing_decisions WHERE event_id = ?", [EVENT_ID]);
    await database.close();
  }

  const restartedDatabase = createDatabaseClient(config.database);
  try {
    const dispatcher = new CommandDispatcher(new MariaCommandDispatchRepository(restartedDatabase), {
      enabled: true, allowAllCanaries: true, canaryUserIds: new Set()
    });
    const signup = await dispatcher.resolve({
      message: "/가입", userId: "synthetic-user", hasTrustedDisplayName: true
    });
    assert.equal(signup.route, "MODERN");
    assert.equal(signup.handlerKey, "USER_SIGNUP");
  } finally {
    await restartedDatabase.close();
  }
  process.stdout.write("partial dispatch synthetic probe: ok\n");
}

await run();
