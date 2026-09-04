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
    if(!/^(?:INSERT|UPDATE|DELETE)\b/.test(sql))throw new Error(`NON_DML_EXECUTE_FORBIDDEN:${sql}`);
    this.calls.push({ kind: "execute", sql, values });
    if (sql.startsWith("UPDATE canonical_owned_pet_title_instances")) this.ownershipStatus = String(values[0]);
    return { affectedRows: 1n, insertId: 0n };
  }
  async withTransaction<T>(work: (participant: AppWiringMutationParticipant) => Promise<T>): Promise<T> { return work(this); }
}

class CreateMutationParticipant extends MutationParticipant {
  constructor(readonly ticketQuantity: bigint | undefined) { super(); }
  override async query<T>(sql: string, values: readonly unknown[] = []): Promise<T> {
    this.calls.push({ kind: "query", sql, values });
    if (sql.includes("FROM canonical_players")) return [{ player_id: "player01" }] as T;
    if (sql.includes("FROM canonical_item_definition_imports")) return [{ item_id: "itemtick" }] as T;
    if (sql.includes("SELECT quantity FROM canonical_owned_item_stacks")) {
      return (this.ticketQuantity === undefined ? [] : [{ quantity: this.ticketQuantity }]) as T;
    }
    if (sql.includes("SELECT resulting_quantity FROM canonical_item_inventory_operations")) return [] as T;
    if (sql.includes("SELECT owned_item_stack_id,quantity FROM canonical_owned_item_stacks")) {
      return (this.ticketQuantity === undefined ? [] : [{ owned_item_stack_id: "stack001", quantity: this.ticketQuantity }]) as T;
    }
    if (sql.includes("FROM object_identity_crosswalks WHERE source_system")) return [] as T;
    if (sql.includes("MAX(acquisition_sequence)")) return [{ next_sequence: 3n }] as T;
    return [] as T;
  }
}

describe("PET-TITLE canonical mutation participant", () => {
  it("debits the exact canonical ticket and creates a distinct definition plus owned occurrence", async () => {
    const database = new CreateMutationParticipant(2n);
    const ids = ["itemop01", "itemled1", "petop001", "petpart1"];
    const result = await new PetTitleCanonicalMutationProvider(() => ids.shift()!, 8, () => new Date("2026-09-05T01:02:03.000Z")).create(database, claim, {
      actor: "pet_title", playerId: "player01", titleName: "같은 이름",
    });
    assert.equal(result.outcomeCode, "CREATED");
    assert.match(result.ownedPetTitleId!, /^[a-z0-9]{8}$/);
    assert.equal(result.remainingTicketQuantity, 1n);
    const ticketLookup = database.calls.find(({ sql }) => sql.includes("FROM canonical_item_definition_imports"));
    assert.deepEqual(ticketLookup?.values, ["펫타이틀권🦊(/펫타이틀이름)"]);
    const ledger = database.calls.find(({ sql }) => sql.includes("INSERT INTO canonical_item_inventory_ledger_entries"));
    assert.equal(ledger?.values[5], -1n);
    assert.equal(ledger?.values[6], "PET_TITLE_TICKET_USED");
    const definitionCrosswalk = database.calls.find(({ sql, values }) => sql.includes("INSERT INTO object_identity_crosswalks") && values[2] === "APP_WIRING" && values[3] === "petTitleDefinition");
    assert.equal(definitionCrosswalk?.values[4], "appwire1");
    const definition = database.calls.find(({ sql }) => sql.includes("INSERT INTO canonical_pet_title_definitions"));
    assert.deepEqual(definition?.values.slice(1, 3), ["같은 이름", 100000000n]);
    const ownership = database.calls.find(({ sql }) => sql.includes("INSERT INTO canonical_owned_pet_title_instances"));
    assert.equal(ownership?.values[1], "player01");
    assert.equal(ownership?.values[2], definition?.values[0]);
    assert.deepEqual(ownership?.values.slice(3, 6), [3n, "2026-09-05 10:02:03", 100000000n]);
    assert.equal(result.ownedPetTitleId, ownership?.values[0]);
    assert.ok(database.calls.some(({ sql, values }) => sql.includes("INSERT INTO canonical_pet_title_operations") && values[0] === "petop001"));
    assert.ok(database.calls.some(({ sql, values }) => sql.includes("INSERT INTO canonical_pet_title_operation_participants") && values[0] === "petpart1"));
  });

  it("records a typed no-op receipt without item or title mutation when the ticket is absent", async () => {
    const database = new CreateMutationParticipant(undefined);
    const ids = ["petop001", "petpart1"];
    const result = await new PetTitleCanonicalMutationProvider(() => ids.shift()!).create(database, claim, {
      actor: "pet_title", playerId: "player01", titleName: "부족",
    });
    assert.equal(result.outcomeCode, "INSUFFICIENT_TICKET");
    assert.equal(result.remainingTicketQuantity, 0n);
    assert.equal(database.calls.some(({ sql }) => /canonical_item_inventory_operations|canonical_pet_title_definitions|canonical_owned_pet_title_instances/.test(sql) && sql.startsWith("INSERT")), false);
    assert.ok(database.calls.some(({ sql }) => sql.includes("INSERT INTO canonical_pet_title_operations")));
  });

  it("keeps equal display names as distinct per-request definitions and owned instances",async()=>{
    const database=new CreateMutationParticipant(2n);
    const ids=["itemop01","itemled1","petop001","petpart1","itemop02","itemled2","petop002","petpart2"];
    const provider=new PetTitleCanonicalMutationProvider(()=>ids.shift()!);
    const first=await provider.create(database,claim,{actor:"pet_title",playerId:"player01",titleName:"중복 이름"});
    const second=await provider.create(database,{...claim,appWiringOperationId:"appwire2",requestKey:"request-2",externalRequestId:"event-2"},{actor:"pet_title",playerId:"player01",titleName:"중복 이름"});
    assert.equal(first.outcomeCode,"CREATED");assert.equal(second.outcomeCode,"CREATED");
    assert.notEqual(first.ownedPetTitleId,second.ownedPetTitleId);
    const bindings=database.calls.filter(({sql,values})=>sql.includes("INSERT INTO object_identity_crosswalks")&&values[3]==="petTitleDefinition");
    assert.deepEqual(bindings.map(({values})=>values[4]),["appwire1","appwire2"]);
    assert.notEqual(bindings[0]?.values[1],bindings[1]?.values[1]);
  });

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
