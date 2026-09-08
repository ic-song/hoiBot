import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MariaDatabaseClient } from "../src/database.js";
import { MariaCanonicalMiniPetRepository } from "../src/mini-pet/canonical-mini-pet-repository.js";

const enabled = process.env.WBS788_MINI_PET_ACQUIRE_MARIADB_TEST === "true";
const integration = enabled ? describe : describe.skip;
const playerId = "w788pl01";
const miniPetId = "w788mp01";
const audit = ["wbs788", "2026-09-09 08:00:00", "wbs788", "2026-09-09 08:00:00"] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

integration("WBS788 canonical mini-pet acquire on isolated MariaDB", () => {
  let database: MariaDatabaseClient;

  before(async () => {
    database = new MariaDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 10,
      connectTimeoutMs: 5_000,
    });
    await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?)", [playerId, "SYNTHETIC", "wbs788-player", ...audit]);
    await database.execute("INSERT INTO canonical_mini_pet_definitions(mini_pet_id,mini_pet_name,mini_pet_emoji,mini_pet_grade,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,TRUE,?,?,?,?)", [miniPetId, "WBS788 미니펫", "🐣", "synthetic", ...audit]);
  });

  after(async () => {
    await database.execute("DROP TRIGGER IF EXISTS wbs788_fail_replay_insert");
    const identities = await database.query<Array<{ object_identity_id: string }>>("SELECT object_identity_id FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_namespace IN ('miniPetOperation','ownedMiniPet') AND source_identifier LIKE ?", [`${playerId}:%`]);
    await database.execute("DELETE FROM canonical_mini_pet_operation_replays WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM canonical_owned_mini_pet_instances WHERE player_id=?", [playerId]);
    await database.execute("DELETE FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_namespace IN ('miniPetOperation','ownedMiniPet') AND source_identifier LIKE ?", [`${playerId}:%`]);
    for (const row of identities) await database.execute("DELETE FROM object_identities WHERE object_identity_id=?", [row.object_identity_id]);
    await database.execute("DELETE FROM canonical_mini_pet_definitions WHERE mini_pet_id=?", [miniPetId]);
    await database.execute("DELETE FROM canonical_players WHERE player_id=?", [playerId]);
    await database.close();
  });

  it("commits one owned row and one replay with four identity-support DML rows", async () => {
    const requestKey = "success-1";
    const result = await new MariaCanonicalMiniPetRepository(database).acquire({ actor: "wbs788", playerId, miniPetId, requestKey, bound: false });
    assert.equal(result.replayed, false);
    const target = await database.query<Array<{ owned_count: bigint; replay_count: bigint }>>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=? AND owned_mini_pet_id=?) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=? AND request_key=?) replay_count", [playerId, result.ownedMiniPetId, playerId, requestKey]);
    assert.deepEqual([target[0]!.owned_count, target[0]!.replay_count], [1n, 1n]);
    const support = await database.query<Array<{ crosswalk_count: bigint; identity_count: bigint }>>("SELECT COUNT(*) crosswalk_count,COUNT(DISTINCT object_identity_id) identity_count FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_namespace IN ('miniPetOperation','ownedMiniPet') AND source_identifier=?", [`${playerId}:${requestKey}`]);
    assert.deepEqual([support[0]!.crosswalk_count, support[0]!.identity_count], [2n, 2n]);
  });

  it("replays after restart with zero additional DML and rejects payload drift", async () => {
    const requestKey = "restart-1";
    const first = await new MariaCanonicalMiniPetRepository(database).acquire({ actor: "wbs788", playerId, miniPetId, requestKey, bound: false });
    const countsBefore = await database.query<Array<{ owned_count: bigint; replay_count: bigint; crosswalk_count: bigint }>>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=?) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=?) replay_count,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_identifier LIKE ?) crosswalk_count", [playerId, playerId, `${playerId}:%`]);
    const replay = await new MariaCanonicalMiniPetRepository(database).acquire({ actor: "another-actor", playerId, miniPetId, requestKey, bound: false });
    const countsAfter = await database.query<typeof countsBefore>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=?) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=?) replay_count,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_identifier LIKE ?) crosswalk_count", [playerId, playerId, `${playerId}:%`]);
    assert.deepEqual(replay, { miniPetOperationId: first.miniPetOperationId, ownedMiniPetId: first.ownedMiniPetId, replayed: true });
    assert.deepEqual(countsAfter, countsBefore);
    await assert.rejects(new MariaCanonicalMiniPetRepository(database).acquire({ actor: "wbs788", playerId, miniPetId, requestKey, bound: true }), /REQUEST_PAYLOAD_CONFLICT/);
  });

  it("rolls back the already affected owned insert when replay insertion fails", async () => {
    const requestKey = "rollback-1";
    const beforeRows = await database.query<Array<{ owned_count: bigint; replay_count: bigint; crosswalk_count: bigint }>>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=?) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=?) replay_count,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_identifier LIKE ?) crosswalk_count", [playerId, playerId, `${playerId}:%`]);
    await database.execute("CREATE TRIGGER wbs788_fail_replay_insert BEFORE INSERT ON canonical_mini_pet_operation_replays FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='WBS788_FORCED_REPLAY_FAILURE'");
    await assert.rejects(new MariaCanonicalMiniPetRepository(database).acquire({ actor: "wbs788", playerId, miniPetId, requestKey, bound: false }), /WBS788_FORCED_REPLAY_FAILURE/);
    await database.execute("DROP TRIGGER wbs788_fail_replay_insert");
    const afterRows = await database.query<typeof beforeRows>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=?) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=?) replay_count,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_identifier LIKE ?) crosswalk_count", [playerId, playerId, `${playerId}:%`]);
    assert.deepEqual(afterRows, beforeRows);
    const requestRows = await database.query<Array<{ owned_count: bigint; replay_count: bigint; crosswalk_count: bigint }>>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=? AND owned_mini_pet_id IN (SELECT object_identity_id FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_identifier=?)) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=? AND request_key=?) replay_count,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_identifier=?) crosswalk_count", [playerId, `${playerId}:${requestKey}`, playerId, requestKey, `${playerId}:${requestKey}`]);
    assert.deepEqual([requestRows[0]!.owned_count, requestRows[0]!.replay_count, requestRows[0]!.crosswalk_count], [0n, 0n, 0n]);
  });

  it("allows one concurrent writer and returns the other call as a terminal replay", async () => {
    const requestKey = "concurrent-1";
    const repository = new MariaCanonicalMiniPetRepository(database);
    const results = await Promise.all([
      repository.acquire({ actor: "wbs788", playerId, miniPetId, requestKey, bound: true }),
      repository.acquire({ actor: "wbs788", playerId, miniPetId, requestKey, bound: true }),
    ]);
    assert.equal(results.filter((entry) => !entry.replayed).length, 1);
    assert.equal(results.filter((entry) => entry.replayed).length, 1);
    assert.equal(new Set(results.map((entry) => entry.ownedMiniPetId)).size, 1);
    const rows = await database.query<Array<{ owned_count: bigint; replay_count: bigint }>>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=? AND owned_mini_pet_id=?) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=? AND request_key=?) replay_count", [playerId, results[0]!.ownedMiniPetId, playerId, requestKey]);
    assert.deepEqual([rows[0]!.owned_count, rows[0]!.replay_count], [1n, 1n]);
  });
});
