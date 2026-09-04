import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { DatabaseWriteResult } from "../src/database.js";
import type { AppWiringClaim, AppWiringMutationParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import { PetExploreEventControlAppWiringProvider } from "../src/pet/pet-explore-event-control-app-wiring-provider.js";
import { ApplicationError } from "../src/shared/application-error.js";

const claim={requestNamespace:"dev:hoi",requestKey:"IRIS:event-1",payloadFingerprint:"a".repeat(64),externalRequestId:"event-1"} as AppWiringClaim;
const event={eventId:"event-1",message:"/펫탐험이벤트비활성화",userId:"operator-1",channelId:"room-1",direction:"incoming"} as NormalizedIrisEvent;

function participant(options:{authorized?:boolean;active?:number;relocated?:bigint}={}){
  const statements:Array<{sql:string;values:readonly unknown[]}>=[];
  let nestedTransactions=0;
  let genericId=100n;
  const database:AppWiringMutationParticipant={
    query:async<T>(sql:string)=>{
      statements.push({sql,values:[]});
      if(sql.includes("operator.id operator_id"))return(options.authorized===false?[]:[{operator_id:7n}]) as T;
      if(sql.includes("pet_explore_runtime_config"))return[{event_mine_active:options.active??1,guild_raid_active:0,version:4n}] as T;
      throw new Error(`UNEXPECTED_QUERY:${sql}`);
    },
    execute:async(sql:string,values:readonly unknown[]=[]):Promise<DatabaseWriteResult>=>{
      statements.push({sql,values});
      if(sql.startsWith("INSERT INTO operations"))return{affectedRows:1n,insertId:genericId++};
      if(sql.startsWith("INSERT INTO pet_explore_event_control_relocations")||sql.startsWith("UPDATE pet_explore_participations"))return{affectedRows:options.relocated??2n,insertId:0n};
      return{affectedRows:1n,insertId:genericId++};
    },
    withTransaction:async<T>(work:(db:AppWiringMutationParticipant)=>Promise<T>)=>{nestedTransactions+=1;return work(database);},
  };
  return{database,statements,get nestedTransactions(){return nestedTransactions;}};
}

describe("PetExploreEventControlAppWiringProvider",()=>{
  it("writes CAS, relocation evidence, audit, both outboxes and a completed canonical receipt",async()=>{
    const fixture=participant({active:1,relocated:3n});
    const provider=new PetExploreEventControlAppWiringProvider(()=>"event001",1,()=>new Date("2026-09-04T00:00:00Z"));
    const result=await provider.execute(fixture.database,event,claim);
    assert.equal(result.operationId,"event001");assert.match(result.resultFingerprint,/^[0-9a-f]{64}$/);
    const mutations=fixture.statements.filter(({sql})=>/^(INSERT|UPDATE|DELETE)/.test(sql));
    assert.match(mutations[0]!.sql,/^INSERT INTO operations/);assert.equal(fixture.nestedTransactions,0);
    assert.equal(fixture.statements.filter(({sql})=>sql.startsWith("INSERT INTO outbox_messages")).length,2);
    assert.equal(fixture.statements.some(({sql})=>sql.startsWith("INSERT INTO command_audit")),true);
    assert.equal(fixture.statements.some(({sql})=>sql.startsWith("INSERT INTO command_executions")),true);
    const receipt=fixture.statements.find(({sql})=>sql.startsWith("INSERT INTO canonical_pet_explore_event_control_operations"));
    assert.ok(receipt);assert.match(receipt.sql,/operation_status[^]*'COMPLETED'/);
    assert.deepEqual(receipt.values.slice(-4),["pet_explore_event_control_app_wiring","2026-09-04 09:00:00","pet_explore_event_control_app_wiring","2026-09-04 09:00:00"]);
    assert.match(mutations.at(-1)!.sql,/^UPDATE operations SET status='completed'/);
  });

  it("fails before the first write when authority is absent",async()=>{
    const fixture=participant({authorized:false});
    await assert.rejects(()=>new PetExploreEventControlAppWiringProvider(()=>"event001").execute(fixture.database,event,claim),error=>error instanceof ApplicationError&&error.code==="PET_EXPLORE_EVENT_CONTROL_FORBIDDEN");
    assert.equal(fixture.statements.some(({sql})=>/^(INSERT|UPDATE|DELETE)/.test(sql)),false);
  });

  it("keeps SETTLEMENT and every LEGACY handler statically fail closed and declares migration 470 rollback",()=>{
    const ingress=readFileSync(new URL("../src/pet/pet-explore-app-wiring-ingress.ts",import.meta.url),"utf8");
    assert.match(ingress,/decision\.route === "MODERN" && family !== "EVENT_CONTROL"/);
    assert.match(ingress,/LEGACY_FALLBACK: \{ READ_ONLY: forbiddenMutation, MUTATION: forbiddenMutation/);
    const migration=readFileSync(new URL("../migrations/470_pet_explore_event_control_app_wiring.sql",import.meta.url),"utf8");
    const rollback=readFileSync(new URL("../migrations/rollback/470_pet_explore_event_control_app_wiring.rollback.sql",import.meta.url),"utf8");
    assert.match(migration,/canonical_pet_explore_event_control_operations/);assert.match(migration,/PET_EXPLORE_EVENT_CONTROL/);
    assert.match(rollback,/DROP TABLE IF EXISTS canonical_pet_explore_event_control_operations/);
  });
});
