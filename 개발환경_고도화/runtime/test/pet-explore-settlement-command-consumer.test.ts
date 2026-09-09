import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { ApplicationError } from "../src/shared/application-error.js";
import { isPetExploreSettlementCommand, PetExploreSettlementCommandConsumer, PetExploreSettlementCommandDispatchAdapter } from "../src/pet/pet-explore-settlement-command-consumer.js";
import { settlementCommandEvent, settlementCommandInput, settlementCommandResult, settlementCommandScenarios } from "./fixtures/pet-explore-settlement-command-consumer.js";

function database(authority: { operator_id: bigint; display_name: string; role_code: string; channel_allowed: number } | undefined): DatabaseClient {
  return { query: async <T>() => (authority ? [authority] : []) as T, execute: async () => ({ affectedRows: 0n, insertId: 0n }), withTransaction: async () => { throw new Error("not used"); }, ping: async () => undefined, verifyRollback: async () => true, close: async () => undefined };
}
const superAdmin = { operator_id: 1n, display_name: "호이 남", role_code: "super_admin", channel_allowed: 0 };
describe("pet explore settlement command consumer", () => {
  it("accepts only the exact command and freezes required scenarios", async () => {
    assert.equal(isPetExploreSettlementCommand("/펫탐험정산"), true);
    for (const value of [undefined, "펫탐험정산", "/펫탐험정산 ", "/펫탐험정산 1", "/펫탐험정산해줘"]) assert.equal(isPetExploreSettlementCommand(value), false);
    assert.equal(settlementCommandScenarios.length, 8);
    const adapter = new PetExploreSettlementCommandDispatchAdapter(new PetExploreSettlementCommandConsumer(database(superAdmin), { load: async () => settlementCommandInput() }, { settle: async () => settlementCommandResult() }));
    assert.equal(await adapter.dispatch(settlementCommandEvent({ message: "/펫탐험정산 " })), null);
  });
  it("allows only super_admin or the allowed-channel open-chat bot", async () => {
    for (const authority of [superAdmin, { operator_id: 2n, display_name: "오픈채팅봇", role_code: "manager", channel_allowed: 1 }]) assert.equal((await new PetExploreSettlementCommandConsumer(database(authority), { load: async () => settlementCommandInput() }, { settle: async () => settlementCommandResult() }).execute(settlementCommandEvent())).status, "settled");
    await assert.rejects(() => new PetExploreSettlementCommandConsumer(database({ operator_id: 3n, display_name: "일반 운영자", role_code: "manager", channel_allowed: 1 }), { load: async () => settlementCommandInput() }, { settle: async () => settlementCommandResult() }).execute(settlementCommandEvent()), (error: unknown) => error instanceof ApplicationError && error.code === "PET_EXPLORE_SETTLEMENT_COMMAND_FORBIDDEN");
  });
  it("passes the immutable SnapshotSource result to settle exactly once", async () => {
    let calls=0;let captured=settlementCommandInput();const snapshot=settlementCommandInput({source:"scheduler",actorId:"999",idempotencyKey:"snapshot-key",destinationId:"snapshot-room"});
    const response=await new PetExploreSettlementCommandConsumer(database(superAdmin),{load:async()=>snapshot},{settle:async input=>{calls++;captured=input;return settlementCommandResult();}}).execute(settlementCommandEvent());
    assert.equal(calls,1);assert.equal(captured,snapshot);assert.match(response.message,/탐험 성공✅\[1명\]/);
  });
  it("maps replay, conflict, not-found and premium RED without local mutation", async () => {
    let calls=0;const consumer=new PetExploreSettlementCommandConsumer(database(superAdmin),{load:async()=>settlementCommandInput()},{settle:async()=>settlementCommandResult({replayed:calls++>0})});
    assert.equal((await consumer.execute(settlementCommandEvent())).replayed,false);assert.equal((await consumer.execute(settlementCommandEvent())).replayed,true);
    const response=async(error:ApplicationError)=>new PetExploreSettlementCommandConsumer(database(superAdmin),{load:async()=>{throw error;}},{settle:async()=>settlementCommandResult()}).execute(settlementCommandEvent());
    assert.equal((await response(new ApplicationError("PET_EXPLORE_SETTLEMENT_ROUND_VERSION_CONFLICT","conflict",409))).status,"conflict");
    assert.equal((await response(new ApplicationError("PET_EXPLORE_SETTLEMENT_ROUND_NOT_FOUND","missing",404))).status,"not_found");
    assert.equal((await response(new ApplicationError("PET_EXPLORE_PREMIUM_POLICY_CONFLICT","gap",409))).status,"policy_blocked");
  });
  it("seeds migration407 and keeps settlement on the shared app-wiring ingress seam",()=>{
    const migration=readFileSync(new URL("../migrations/407_pet_explore_settlement_command_consumer.sql",import.meta.url),"utf8"),app=readFileSync(new URL("../src/app.ts",import.meta.url),"utf8");
    assert.match(migration,/ADMIN_PET_EXPLORE_SETTLEMENT/);assert.match(migration,/'\/펫탐험정산'/);assert.match(migration,/'SHADOW'/);
    assert.match(app,/dispatchPetExploreSettlementCommand\(ingress,isOperationalChannel,duplicate,event\)/);
  });
});
