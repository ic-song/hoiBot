import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseWriteResult } from "../src/database.js";
import type { AppWiringClaim, AppWiringMutationParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import { PetTitleCanonicalMutationProvider } from "../src/pet/pet-title-canonical-mutation-provider.js";

const claim: AppWiringClaim = {
  appWiringOperationId: "appwire1", requestIdentityFingerprint: "a".repeat(64), requestNamespace: "DEV:IRIS:pet-title",
  entrypointKind: "IRIS", externalRequestId: "event-1", requestKey: "request-1", payloadFingerprint: "b".repeat(64),
  route: "MODERN", effectMode: "MUTATION", reasonCode: "ACTIVE", handlerKey: "pet_title_lifecycle", claimState: "CLAIMED",
};

class MutationParticipant implements AppWiringMutationParticipant {
  readonly calls: Array<{ kind: "query" | "execute"; sql: string; values: readonly unknown[] }> = [];
  ownershipStatus = "owned";
  async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    this.calls.push({ kind: "query", sql, values });
    if (sql.includes("SELECT pet_title_id,ownership_status")) return [{ pet_title_id: "pettitl1", ownership_status: this.ownershipStatus }] as T;
    if (sql.includes("SELECT owned_pet_title_id AS owned_title_id")) return [{ owned_title_id: "petown01" }] as T;
    if (sql.includes("SELECT ownership_status FROM canonical_owned_pet_title_instances")) return [{ ownership_status: this.ownershipStatus }] as T;
    return [] as T;
  }
  async execute(sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> {
    this.calls.push({ kind: "execute", sql, values });
    if (sql.startsWith("UPDATE canonical_owned_pet_title_instances")) this.ownershipStatus = String(values[0]);
    return { affectedRows: 1n, insertId: 0n };
  }
  async withTransaction<T>(work: (participant: AppWiringMutationParticipant) => Promise<T>): Promise<T> { return work(this); }
}

describe("PET-TITLE canonical mutation participant", () => {
  it("selects an owned occurrence and persists its typed receipt plus OWNER participant", async () => {
    const database = new MutationParticipant();
    const ids = ["petop001", "petpart1"];
    const result = await new PetTitleCanonicalMutationProvider(() => ids.shift()!).select(database, claim, { actor: "pet_title", playerId: "player01", ownedPetTitleId: "petown01" });
    assert.equal(result.operationId, "petop001");
    assert.match(result.resultFingerprint, /^[0-9a-f]{64}$/);
    assert.ok(database.calls.some(({ sql }) => sql.startsWith("INSERT INTO canonical_pet_title_selections")));
    assert.ok(database.calls.some(({ sql }) => sql.startsWith("INSERT INTO canonical_pet_title_operations")));
    assert.ok(database.calls.some(({ sql, values }) => sql.startsWith("INSERT INTO canonical_pet_title_operation_participants") && values[2] === "player01"));
  });

  it("removes ownership, clears selection, and rejects a non-mutation claim before writes", async () => {
    const database = new MutationParticipant();
    const ids = ["petop002", "petpart2"];
    const result = await new PetTitleCanonicalMutationProvider(() => ids.shift()!).release(database, claim, { actor: "pet_title", playerId: "player01", ownedPetTitleId: "petown01", status: "removed" });
    assert.equal(result.operationType, "REMOVE");
    assert.ok(database.calls.some(({ sql }) => sql.startsWith("DELETE FROM canonical_pet_title_selections")));
    assert.ok(database.calls.some(({ sql, values }) => sql.startsWith("UPDATE canonical_owned_pet_title_instances") && values[0] === "removed"));
    const denied = new MutationParticipant();
    await assert.rejects(new PetTitleCanonicalMutationProvider().select(denied, { ...claim, effectMode: "READ_ONLY" }, { actor: "pet_title", playerId: "player01", ownedPetTitleId: "petown01" }), /PET_TITLE_APP_WIRING_MUTATION_CLAIM_REQUIRED/);
    assert.equal(denied.calls.length, 0);
  });

  it("rejects sale before reads or writes until currency settlement joins the same transaction", async () => {
    const database = new MutationParticipant();
    await assert.rejects(
      new PetTitleCanonicalMutationProvider().release(database, claim, {
        actor: "pet_title", playerId: "player01", ownedPetTitleId: "petown01", status: "sold",
      }),
      /PET_TITLE_SELL_CURRENCY_PARTICIPANT_REQUIRED/,
    );
    assert.equal(database.calls.length, 0);
  });
});
