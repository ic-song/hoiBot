import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../src/database.js";
import { MariaCanonicalTitleRepository, type CanonicalTitleDomain } from "../src/title/maria-canonical-title-repository.js";

class RecordingDatabase implements DatabaseClient, DatabaseTransaction {
  readonly calls: Array<{ kind: "query" | "execute"; sql: string; values: readonly unknown[] }> = [];
  listRows: unknown[] = [];

  async ping(): Promise<void> {}
  async verifyRollback(): Promise<boolean> { return true; }
  async close(): Promise<void> {}
  async withTransaction<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> { return work(this); }

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    this.calls.push({ kind: "query", sql, values });
    if (sql.includes("object_identity_crosswalks")) return [] as T;
    if (sql.includes(" AS owned_title_id FROM canonical_owned_")) return [{ owned_title_id: values[0] }] as T;
    if (sql.includes("SELECT ownership_status FROM canonical_owned_")) return [{ ownership_status: "owned" }] as T;
    if (sql.includes(" AS title_definition_id FROM canonical_") && sql.includes("_title_definitions")) return [{ title_definition_id: values[0] }] as T;
    if (sql.includes("definition_row.title_name")) return this.listRows as T;
    return [] as T;
  }

  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    this.calls.push({ kind: "execute", sql, values });
    assert.equal((sql.match(/\?/g) ?? []).length, values.length, sql);
    return { affectedRows: 1n, insertId: 0n };
  }
}

class GrantReplayDatabase extends RecordingDatabase {
  override async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    this.calls.push({ kind: "query", sql, values });
    if (sql.includes("object_identity_crosswalks")) return [{
      object_identity_crosswalk_id: "crossw01", object_identity_id: "ownpet01",
      INSERT_USER: "first", INSERT_TIME: "2026-09-03 10:00:00", UPDATE_USER: "first", UPDATE_TIME: "2026-09-03 10:00:00"
    }] as T;
    if (sql.includes("FROM canonical_owned_pet_title_instances")) return [{
      player_id: "player01", title_definition_id: "petttl01", acquisition_sequence: 1n,
      acquired_time: "2026-09-03 10:02:00", acquisition_price: 100000000n, ownership_status: "owned"
    }] as T;
    return [] as T;
  }
}

const domainIds: Record<CanonicalTitleDomain, { definition: string; owned: string; definitionTable: string; ownershipTable: string; selectionTable: string }> = {
  member: { definition: "memttl01", owned: "ownmem01", definitionTable: "canonical_member_title_definitions", ownershipTable: "canonical_owned_member_title_instances", selectionTable: "canonical_member_title_selections" },
  pet: { definition: "petttl01", owned: "ownpet01", definitionTable: "canonical_pet_title_definitions", ownershipTable: "canonical_owned_pet_title_instances", selectionTable: "canonical_pet_title_selections" },
  mini_pet: { definition: "minttl01", owned: "ownmini1", definitionTable: "canonical_mini_pet_title_definitions", ownershipTable: "canonical_owned_mini_pet_title_instances", selectionTable: "canonical_mini_pet_title_selections" }
};

describe("MariaCanonicalTitleRepository", () => {
  it("routes all three definition and grant flows through separate domain tables and the shared identity provider", async () => {
    for (const domain of Object.keys(domainIds) as CanonicalTitleDomain[]) {
      const database = new RecordingDatabase();
      const repository = new MariaCanonicalTitleRepository(database, () => new Date("2026-09-03T01:00:00Z"));
      const definition = await repository.registerDefinition({
        domain, actor: "wbs737", sourceSystem: "SYNTHETIC", sourceIdentifier: `${domain}-definition-1`,
        titleName: `${domain} 타이틀✨`, baseSalePrice: 100000000n
      });
      assert.equal(definition.replayed, false);
      assert.equal(definition.titleDefinitionId.length, 8);
      const grant = await repository.grant({
        domain, actor: "wbs737", sourceSystem: "SYNTHETIC", requestKey: `${domain}-grant-1`,
        playerId: "player01", titleDefinitionId: definition.titleDefinitionId,
        acquisitionSequence: 1n, acquiredTime: "2026-09-03 10:00:00", acquisitionPrice: 100000000n
      });
      assert.equal(grant.replayed, false);
      assert.equal(grant.ownedTitleId.length, 8);
      assert.ok(database.calls.some((call) => call.sql.includes(domainIds[domain].definitionTable)));
      assert.ok(database.calls.some((call) => call.sql.includes(domainIds[domain].ownershipTable)));
      assert.ok(database.calls.some((call) => call.sql.includes("INSERT INTO object_identities")));
    }
  });

  it("selects only an owned title for the same player and upserts one current relation", async () => {
    const database = new RecordingDatabase();
    const repository = new MariaCanonicalTitleRepository(database, () => new Date("2026-09-03T01:00:00Z"));
    await repository.select({ domain: "pet", actor: "wbs737", playerId: "player01", ownedTitleId: "ownpet01" });
    const lock = database.calls.find((call) => call.kind === "query")!;
    assert.match(lock.sql, /owned_pet_title_id=\? AND player_id=\? AND ownership_status='owned' FOR UPDATE/);
    const upsert = database.calls.find((call) => call.sql.includes("INSERT INTO canonical_pet_title_selections"))!;
    assert.match(upsert.sql, /ON DUPLICATE KEY UPDATE owned_pet_title_id=VALUES\(owned_pet_title_id\)/);
  });

  it("releases ownership and clears only the matching current selection in one transaction", async () => {
    const database = new RecordingDatabase();
    const repository = new MariaCanonicalTitleRepository(database, () => new Date("2026-09-03T01:00:00Z"));
    const replayed = await repository.release({ domain: "mini_pet", actor: "wbs737", playerId: "player01", ownedTitleId: "ownmini1", status: "sold" });
    assert.equal(replayed, false);
    const statements = database.calls.map((call) => call.sql);
    assert.ok(statements.some((sql) => sql.includes("DELETE FROM canonical_mini_pet_title_selections")));
    assert.ok(statements.some((sql) => sql.includes("UPDATE canonical_owned_mini_pet_title_instances SET ownership_status=?")));
  });

  it("reads current definition values without copying names or prices into ownership rows", async () => {
    const database = new RecordingDatabase();
    database.listRows = [{
      owned_title_id: "ownmem01", title_definition_id: "memttl01", title_name: "변경된 타이틀✨",
      base_sale_price: 300000000n, acquisition_price: 100000000n, acquisition_sequence: 1n, acquired_time: "2026-09-03 10:00:00", selected_flag: 1
    }];
    const repository = new MariaCanonicalTitleRepository(database);
    const rows = await repository.listOwned("member", "player01");
    assert.deepEqual(rows, [{
      ownedTitleId: "ownmem01", titleDefinitionId: "memttl01", titleName: "변경된 타이틀✨",
      baseSalePrice: 300000000n, acquisitionPrice: 100000000n, acquisitionSequence: 1n, acquiredTime: "2026-09-03 10:00:00", selected: true
    }]);
    assert.match(database.calls[0]!.sql, /JOIN canonical_member_title_definitions/);
  });

  it("updates a shared definition once without scanning ownership rows", async () => {
    const database = new RecordingDatabase();
    const repository = new MariaCanonicalTitleRepository(database, () => new Date("2026-09-03T01:00:00Z"));
    await repository.updateDefinition({ domain: "member", actor: "balance", titleDefinitionId: "memttl01", titleName: "새 공통 타이틀", baseSalePrice: 500000000n });
    assert.equal(database.calls.filter((call) => call.kind === "execute" && call.sql.startsWith("UPDATE canonical_member_title_definitions")).length, 1);
    assert.ok(database.calls.some((call) => /^UPDATE canonical_member_title_definitions SET title_name=\?,base_sale_price=\?/.test(call.sql)));
    assert.ok(database.calls.every((call) => !call.sql.includes("canonical_owned_member_title_instances")));
  });

  it("replays an identical grant and rejects reuse of the request key with changed state", async () => {
    const database = new GrantReplayDatabase();
    const repository = new MariaCanonicalTitleRepository(database);
    const input = {
      domain: "pet" as const, actor: "wbs737", sourceSystem: "SYNTHETIC", requestKey: "pet-grant-1",
      playerId: "player01", titleDefinitionId: "petttl01", acquisitionSequence: 1n, acquiredTime: "2026-09-03 10:02:00", acquisitionPrice: 100000000n
    };
    assert.deepEqual(await repository.grant(input), { ownedTitleId: "ownpet01", replayed: true });
    await assert.rejects(repository.grant({ ...input, acquisitionSequence: 2n }), /CANONICAL_TITLE_GRANT_REQUEST_CONFLICT/);
    await assert.rejects(repository.grant({ ...input, acquisitionPrice: 200000000n }), /CANONICAL_TITLE_GRANT_REQUEST_CONFLICT/);
    assert.equal(database.calls.filter((call) => call.sql.includes("INSERT INTO canonical_owned_pet_title_instances")).length, 0);
  });

  it("rejects invalid acquisition state before any database write", async () => {
    const database = new RecordingDatabase();
    const repository = new MariaCanonicalTitleRepository(database);
    await assert.rejects(
      repository.grant({ domain: "member", actor: "wbs737", sourceSystem: "SYNTHETIC", requestKey: "bad-time", playerId: "player01", titleDefinitionId: "memttl01", acquisitionSequence: 0n, acquiredTime: "2026-09-03 25:00:00" }),
      /CANONICAL_TITLE_SEQUENCE_INVALID/
    );
    await assert.rejects(
      repository.grant({ domain: "member", actor: "wbs737", sourceSystem: "SYNTHETIC", requestKey: "bad-price", playerId: "player01", titleDefinitionId: "memttl01", acquisitionSequence: 1n, acquiredTime: "2026-09-03 10:00:00", acquisitionPrice: -1n }),
      /CANONICAL_TITLE_ACQUISITION_PRICE_INVALID/
    );
    assert.equal(database.calls.length, 0);
  });
});
