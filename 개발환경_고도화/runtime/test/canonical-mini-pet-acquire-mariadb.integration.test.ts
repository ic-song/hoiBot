import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { MariaDatabaseClient } from "../src/database.js";
import { MariaCanonicalMiniPetRepository } from "../src/mini-pet/canonical-mini-pet-repository.js";
import { requireWbs788IsolatedMariaEnvironment } from "./fixtures/wbs788-isolated-maria.js";

const enabled = process.env.WBS788_MINI_PET_ACQUIRE_MARIADB_TEST === "true";
const guardedConfig = enabled ? requireWbs788IsolatedMariaEnvironment(process.env) : undefined;
const integration = enabled ? describe : describe.skip;
const playerId = "w788pl01";
const otherPlayerId = "w788pl02";
const miniPetId = "w788mp01";
const audit = ["wbs788", "2026-09-09 08:00:00", "wbs788", "2026-09-09 08:00:00"] as const;
const execFileAsync = promisify(execFile);
const restartChildPath = fileURLToPath(new URL("./fixtures/canonical-mini-pet-acquire-restart-child.ts", import.meta.url));

describe("WBS788 isolated MariaDB startup guard", () => {
  const safe = { DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3345", DATABASE_USER: "wbs788", DATABASE_PASSWORD: "test-only", DATABASE_NAME: "hoibot_wbs788" };
  it("accepts only the exact local non-production boundary", () => assert.deepEqual(requireWbs788IsolatedMariaEnvironment(safe), { host: "127.0.0.1", port: 3345, user: "wbs788", password: "test-only", name: "hoibot_wbs788" }));
  it("rejects a non-loopback host before a client is created", () => assert.throws(() => requireWbs788IsolatedMariaEnvironment({ ...safe, DATABASE_HOST: "localhost" }), /HOST_FORBIDDEN/));
  it("rejects production port 3306 before a client is created", () => assert.throws(() => requireWbs788IsolatedMariaEnvironment({ ...safe, DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3306" }), /PORT_FORBIDDEN/));
  it("rejects a database outside the WBS788 prefix before a client is created", () => assert.throws(() => requireWbs788IsolatedMariaEnvironment({ ...safe, DATABASE_HOST: "127.0.0.1", DATABASE_NAME: "hoibot" }), /DATABASE_NAME_FORBIDDEN/));
});

integration("WBS788 canonical mini-pet acquire on isolated MariaDB", () => {
  let database: MariaDatabaseClient;

  before(async () => {
    assert.ok(guardedConfig !== undefined);
    database = new MariaDatabaseClient({
      enabled: true,
      ...guardedConfig,
      connectionLimit: 10,
      connectTimeoutMs: 5_000,
    });
    await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?),(?,?,?,?,?,?,?)", [playerId, "SYNTHETIC", "wbs788-player", ...audit, otherPlayerId, "SYNTHETIC", "wbs788-other-player", ...audit]);
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
    await database.execute("DELETE FROM canonical_players WHERE player_id IN (?,?)", [playerId, otherPlayerId]);
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
    const child = await execFileAsync(process.execPath, ["--import", "tsx", restartChildPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, WBS788_PLAYER_ID: playerId, WBS788_MINI_PET_ID: miniPetId, WBS788_REQUEST_KEY: requestKey, WBS788_BOUND: "false" },
    });
    const childResult = JSON.parse(child.stdout) as { pid: number; result: { miniPetOperationId: string; ownedMiniPetId: string; replayed: boolean } };
    const countsAfter = await database.query<typeof countsBefore>("SELECT (SELECT COUNT(*) FROM canonical_owned_mini_pet_instances WHERE player_id=?) owned_count,(SELECT COUNT(*) FROM canonical_mini_pet_operation_replays WHERE player_id=?) replay_count,(SELECT COUNT(*) FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_identifier LIKE ?) crosswalk_count", [playerId, playerId, `${playerId}:%`]);
    assert.notEqual(childResult.pid, process.pid);
    assert.deepEqual(childResult.result, { miniPetOperationId: first.miniPetOperationId, ownedMiniPetId: first.ownedMiniPetId, replayed: true });
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
    const support = await database.query<Array<{ crosswalk_count: bigint; identity_count: bigint }>>("SELECT COUNT(*) crosswalk_count,COUNT(DISTINCT object_identity_id) identity_count FROM object_identity_crosswalks WHERE source_system='CANONICAL_RUNTIME' AND source_namespace IN ('miniPetOperation','ownedMiniPet') AND source_identifier=?", [`${playerId}:${requestKey}`]);
    assert.deepEqual([support[0]!.crosswalk_count, support[0]!.identity_count], [2n, 2n]);
  });

  it("binds the terminal owned id to the same player through the composite foreign key", async () => {
    const requestKey = "owner-fk-1";
    const result = await new MariaCanonicalMiniPetRepository(database).acquire({ actor: "wbs788", playerId, miniPetId, requestKey, bound: false });
    const replay = await database.query<Array<{ replay_player_id: string; owned_player_id: string }>>("SELECT replay.player_id replay_player_id,owned.player_id owned_player_id FROM canonical_mini_pet_operation_replays replay JOIN canonical_owned_mini_pet_instances owned ON owned.owned_mini_pet_id=replay.owned_mini_pet_id AND owned.player_id=replay.player_id WHERE replay.player_id=? AND replay.request_key=?", [playerId, requestKey]);
    assert.deepEqual(replay, [{ replay_player_id: playerId, owned_player_id: playerId }]);
    await assert.rejects(database.execute("INSERT INTO canonical_mini_pet_operation_replays(mini_pet_operation_id,player_id,request_key,operation_kind,payload_fingerprint,owned_mini_pet_id,operation_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,'acquire',REPEAT('a',64),?,'completed',?,?,?,?)", ["w788op02", otherPlayerId, "cross-owner", result.ownedMiniPetId, ...audit]), (error: unknown) => typeof error === "object" && error !== null && "errno" in error && error.errno === 1452);
  });
});
