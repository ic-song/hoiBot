import assert from "node:assert/strict";
import { describe,it } from "node:test";
import type { PlayerContextPort } from "../src/account-platform/player-context-provider.js";
import { PetTitleAdminAppWiringIngress } from "../src/admin/pet-title-admin-app-wiring-ingress.js";
import type { AppWiringClaim,AppWiringMutationParticipant,MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import type { CommandDispatcher } from "../src/dispatch/command-dispatcher.js";

const input={eventId:"admin-event-1",externalUserId:"operator-external",channelId:"room-1",message:"/펫타이틀추가 대상, 별빛 100"};

function fixture(route:"MODERN"|"SHADOW"|"LEGACY_FALLBACK"){
  const writes:string[]=[],queries:string[]=[];let mutationCalls=0;let actor="",activePlayerIds:readonly string[]=[];
  const database:AppWiringMutationParticipant={
    query:async<T>(sql:string)=>{
      queries.push(sql);
      if(sql.includes("account_platform_active_player_selections"))return [{active_player_selection_id:"select01"}] as T;
      if(sql.includes("SELECT DISTINCT mapping.operator_id"))return [{operator_id:7n}] as T;
      if(sql.includes("canonical_pet_title_global_locks"))return [{lock_key:"PET_TITLE"}] as T;
      if(sql.includes("FROM players player"))return [{player_id:17n,canonical_player_id:"player01"}] as T;
      return [] as T;
    },
    execute:async(sql:string)=>{writes.push(sql);return{affectedRows:1n,insertId:1n};},
    withTransaction:async<T>(work:(participant:AppWiringMutationParticipant)=>Promise<T>)=>work(database),
  };
  const claim:AppWiringClaim={appWiringOperationId:"appwire1",requestIdentityFingerprint:"a".repeat(64),requestNamespace:"DEV:IRIS:admin",entrypointKind:"IRIS",externalRequestId:input.eventId,requestKey:"request-1",payloadFingerprint:"b".repeat(64),route:"MODERN",effectMode:"MUTATION",reasonCode:"MODERN_ROUTE_ALLOWED",handlerKey:"admin_pet_title_add",claimState:"CLAIMED"};
  const provider={
    prepare:async()=>({claim,replayed:false as const}),
    runMutationReply:async(_prepared:unknown,handler:(db:AppWiringMutationParticipant,activeClaim:AppWiringClaim)=>Promise<{value:unknown;reply:{data:string;destinationId:string}}>)=>{const result=await handler(database,claim);return{value:result.value,reply:{outboxId:"outbox-1",room:result.reply.destinationId,data:result.reply.data}};},
    fail:async()=>{},
  } as unknown as MariaAppWiringOperationProvider;
  const dispatcher={resolveByCodeReadOnly:async()=>({route,reasonCode:route==="MODERN"?"MODERN_ROUTE_ALLOWED":"ROLLOUT_GUARD",commandCode:"ADMIN_PET_TITLE_ADD",handlerKey:"admin_pet_title_add"})} as unknown as CommandDispatcher;
  const contexts:PlayerContextPort={resolveSelf:async()=>({canonicalPlayerId:"player01",legacyPlayerId:"17",externalIdentityId:"identity-1",displayName:"운영자",rankEmoji:null,platformCode:"kakao",externalContextId:"room-1",selectionSource:"ACTIVE_CONTEXT"}),resolveUniqueLegacyDisplayTarget:async()=>({canonicalPlayerId:"player01",legacyPlayerId:"17",displayName:"대상",rankEmoji:null})};
  const ingress=new PetTitleAdminAppWiringIngress(provider,dispatcher,contexts,{
    adminGrant:async(_db,_claim,value)=>{mutationCalls+=1;actor=value.actor;return{operationId:"petop001",resultFingerprint:"c".repeat(64),replayedDomainState:false,operationType:"ADMIN_GRANT",ownedPetTitleId:"owned001",petTitleId:"title001",titleName:value.titleName,acquisitionSequence:1n};},
    adminSync:async(_db,_claim,value)=>{mutationCalls+=1;actor=value.actor;activePlayerIds=value.activePlayerIds;return{operationId:"batch001",resultFingerprint:"d".repeat(64),replayedDomainState:false,operationType:"ADMIN_SYNC",affectedPlayerCount:1,affectedTitleCount:2,affectedPlayerIds:["orphan01"],affectedMemberKeys:["삭제회원"]};},adminReset:async()=>{throw new Error("unused");},
  },{lockSnapshot:async()=>({activeCanonicalPlayerIds:["player01","player02"]})});
  return{ingress,writes,queries,mutationCalls:()=>mutationCalls,actor:()=>actor,activePlayerIds:()=>activePlayerIds};
}

describe("PET-TITLE admin app-wiring ingress",()=>{
  it("keeps SHADOW and legacy routes outside business, receipt, and outbox DML",async()=>{
    for(const route of ["SHADOW","LEGACY_FALLBACK"] as const){
      const current=fixture(route);const result=await current.ingress.add(input,{targetName:"대상",titleName:"별빛",priceDigits:"100"});
      assert.equal(result.status,route==="SHADOW"?"shadow":"legacy_fallback");
      assert.equal(current.mutationCalls(),0);assert.deepEqual(current.writes,[]);
    }
  });

  it("records the distinct authorized operator identity as the canonical audit actor",async()=>{
    const current=fixture("MODERN");const result=await current.ingress.add(input,{targetName:"대상",titleName:"별빛",priceDigits:"100"});
    assert.equal(result.status,"changed");assert.equal(current.mutationCalls(),1);assert.equal(current.actor(),"pet_title_admin_operator_7");
    assert.ok(current.queries.findIndex(sql=>sql.includes("canonical_pet_title_global_locks"))<current.queries.findIndex(sql=>sql.includes("account_platform_active_player_selections")));
  });

  it("runs active sync only with the selected account context and exact active-member authority",async()=>{
    const current=fixture("MODERN");const result=await current.ingress.sync({...input,message:"/펫타이틀동기화"});
    assert.equal(result.status,"changed");assert.equal(current.mutationCalls(),1);
    assert.equal(current.actor(),"pet_title_admin_operator_7");assert.deepEqual(current.activePlayerIds(),["player01","player02"]);
    if(result.status==="changed")assert.match(result.data,/펫타이틀데이터 동기화완료 \(1\).*삭제회원/s);
  });

  it("keeps SHADOW and legacy sync outside authority and mutation work",async()=>{
    for(const route of ["SHADOW","LEGACY_FALLBACK"] as const){const current=fixture(route);assert.equal((await current.ingress.sync({...input,message:"/펫타이틀동기화"})).status,route==="SHADOW"?"shadow":"legacy_fallback");assert.equal(current.mutationCalls(),0);assert.deepEqual(current.queries,[]);assert.deepEqual(current.writes,[]);}
  });
});
