import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppWiringClaim, AppWiringMutationParticipant, AppWiringReadParticipant, MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
import type { NormalizedIrisEvent } from "../src/integration/iris-normalizer.js";
import type { PlayerContext, PlayerContextPort } from "../src/account-platform/player-context-provider.js";
import {
  PetTitleShadowEvaluator,
  PetTitleAppWiringIngress,
  type PetTitleReadAuthorityPort,
} from "../src/pet/pet-title-app-wiring-ingress.js";

const actor: PlayerContext = {
  canonicalPlayerId: "player01", legacyPlayerId: "17", externalIdentityId: "31",
  displayName: "호이", rankEmoji: "👑", platformCode: "kakao", externalContextId: "room-1",
  selectionSource: "ACTIVE_CONTEXT",
};

function event(message: string): NormalizedIrisEvent {
  return {
    eventId: "pet-title-1", providerEventId: "pet-title-1", providerCode: "iris", eventKind: "1",
    direction: "incoming", channelId: "room-1", userId: "external-1", displayName: "호이",
    displayNameSource: "kakao_db", displayNameTrust: "trusted", message, eventCode: "message.created",
    eventCategory: "message", monitoringGroup: "text", eventMetadata: {}, payloadHash: "a".repeat(64),
  };
}

const database: AppWiringReadParticipant = { query: async <T>(sql:string) => (sql.includes("account_platform_active_player_selections")?[{active_player_selection_id:"sel00001"}]:[]) as T };

function ports(allowed: boolean) {
  const calls: Array<{ method: string; value: unknown }> = [];
  const contexts: PlayerContextPort = {
    resolveSelf: async (_database, input) => { calls.push({ method: "self", value: input }); return actor; },
    resolveUniqueLegacyDisplayTarget: async (_database, input) => {
      calls.push({ method: "target", value: input });
      return { ...actor, canonicalPlayerId: "player02", displayName: "대상회원" };
    },
  };
  const authority: PetTitleReadAuthorityPort = {
    canReadAny: async (_database, value) => { calls.push({ method: "authority", value }); return allowed; },
  };
  return { contexts, authority, calls };
}

describe("PET-TITLE app-wiring shadow boundary", () => {
  it("uses the injected active player context and canonical read provider for self", async () => {
    const fixture = ports(false);
    const evaluator = new PetTitleShadowEvaluator(fixture.contexts, fixture.authority, {
      listOwned: async (_database, playerId) => {
        assert.equal(playerId, "player01");
        return [{ instanceId: "owned001", displayName: "별빛", priceDigits: "1000", acquiredAt: "2026-09-05 01:02:03", equipped: true }];
      },
    });
    const result = await evaluator.preview(database, event("/펫타이틀목록"));
    assert.equal(result.authorized, true);
    assert.equal(result.canonicalPlayerId, "player01");
    assert.match(result.reply!, /☞ 1\. 별빛/);
    assert.deepEqual(fixture.calls.map(({ method }) => method), ["self"]);
  });

  it("preserves the legacy JavaScript first-four-code-unit target key and checks authority first", async () => {
    const fixture = ports(true);
    const evaluator = new PetTitleShadowEvaluator(fixture.contexts, fixture.authority, { listOwned: async () => [] });
    const result = await evaluator.preview(database, event("/펫타이틀목록 대상회원추가"));
    assert.equal(result.authorized, true);
    assert.deepEqual(fixture.calls.map(({ method }) => method), ["self", "authority", "target"]);
    assert.deepEqual(fixture.calls[2]!.value, { targetKey: "대상회원" });
  });

  it("does not resolve or read a target when read-any authority is denied", async () => {
    const fixture = ports(false);
    let readCount = 0;
    const evaluator = new PetTitleShadowEvaluator(fixture.contexts, fixture.authority, { listOwned: async () => { readCount += 1; return []; } });
    const result = await evaluator.preview(database, event("/펫타이틀목록 대상회원"));
    assert.equal(result.authorized, false);
    assert.equal(readCount, 0);
    assert.deepEqual(fixture.calls.map(({ method }) => method), ["self", "authority"]);
  });

  it("previews a stable owned occurrence for selection without mutating it", async () => {
    const fixture = ports(false);
    const queries: string[] = [];
    const evaluator = new PetTitleShadowEvaluator(fixture.contexts, fixture.authority, {
      listOwned: async (_database, playerId) => {
        assert.equal(playerId, "player01");
        return [
          { instanceId: "owned001", displayName: "첫째", priceDigits: "100", acquiredAt: "2026-09-05 01:02:03", equipped: false },
          { instanceId: "owned002", displayName: "둘째", priceDigits: "200", acquiredAt: "2026-09-05 01:02:04", equipped: false },
        ];
      },
    });
    const readOnlyDatabase: AppWiringReadParticipant = {
      query: async <T>(sql: string) => { queries.push(sql); return [{ active: 0, lifecycle_state: "READY" }] as T; },
    };
    const result = await evaluator.preview(readOnlyDatabase, event("/펫타이틀 2"));
    assert.equal(result.outcomeCode, "READY");
    assert.equal(result.canonicalPlayerId, "player01");
    assert.equal(result.reply, "[👑호이] 님의 **펫 타이틀**이\n[둘째] (으)로 적용되었습니다.");
    assert.equal(queries.length, 1);
    assert.deepEqual(fixture.calls.map(({ method }) => method), ["self"]);
  });

  it("records deterministic selection guard outcomes before any canonical mutation", async () => {
    const fixture = ports(false);
    let titleReads = 0;
    const evaluator = new PetTitleShadowEvaluator(fixture.contexts, fixture.authority, {
      listOwned: async () => { titleReads += 1; return []; },
    });
    const noCastle: AppWiringReadParticipant = { query: async <T>() => [{ active: 0, lifecycle_state: "READY" }] as T };
    assert.equal((await evaluator.preview(noCastle, event("/펫타이틀 0"))).outcomeCode, "INDEX_INVALID");
    assert.equal((await evaluator.preview(noCastle, event("/펫타이틀 9"))).outcomeCode, "NOT_FOUND");
    const activeCastle: AppWiringReadParticipant = { query: async <T>() => [{ active: 1, lifecycle_state: "ACTIVE_READY" }] as T };
    assert.equal((await evaluator.preview(activeCastle, event("/펫타이틀 1"))).outcomeCode, "SILENT_CASTLE_ACTIVE");
    assert.equal(titleReads, 1);
  });
});

function ingressFor(route:"MODERN"|"SHADOW"|"REJECT",replay=false,replayStatus="REPLY_QUEUED"){
  let previewCalls=0;
  let createCalls=0;
  let sellCalls=0;
  const baseClaim:AppWiringClaim={appWiringOperationId:"claim001",requestIdentityFingerprint:"a".repeat(64),requestNamespace:"hoibot:dev:hoi_bot",entrypointKind:"IRIS",externalRequestId:"pet-title-1",requestKey:"IRIS:pet-title-1",payloadFingerprint:"b".repeat(64),route,effectMode:"READ_ONLY",reasonCode:route==="REJECT"?"AUTH_SCOPE_NOT_SATISFIED":"CANARY",handlerKey:"pet_title_lifecycle",claimState:replay?"COMPLETED":"CLAIMED",...(replay?{result:{status:replayStatus,referenceId:"petop001",resultFingerprint:"c".repeat(64)}}:{})};
  const provider={
    prepare:async(_input:unknown,resolveRoute:()=>Promise<{effectMode?:"READ_ONLY"|"MUTATION"}>|{effectMode?:"READ_ONLY"|"MUTATION"})=>{const decision=await resolveRoute();const claim={...baseClaim,effectMode:decision.effectMode??"READ_ONLY"} as AppWiringClaim;return replay?{claim,replayed:true as const}:{claim,replayed:false as const};},
    runReadOnlyReply:async(prepared:{claim:AppWiringClaim},handler:(database:AppWiringReadParticipant,claim:AppWiringClaim)=>Promise<{value:unknown;reply:{destinationId:string;data:string}}>)=>{const outcome=await handler(database,prepared.claim);return {value:outcome.value,reply:{outboxId:"21",room:outcome.reply.destinationId,data:outcome.reply.data}};},
    runMutationReply:async(prepared:{claim:AppWiringClaim},handler:(database:AppWiringMutationParticipant,claim:AppWiringClaim)=>Promise<{value:unknown;reply:{destinationId:string;data:string}}>)=>{const outcome=await handler(database as AppWiringMutationParticipant,prepared.claim);return {value:outcome.value,reply:{outboxId:"22",room:outcome.reply.destinationId,data:outcome.reply.data}};},
    runMutationIrisOutcome:async(prepared:{claim:AppWiringClaim},handler:(database:AppWiringMutationParticipant,claim:AppWiringClaim)=>Promise<{value:unknown;reply?:{destinationId:string;data:string};noReply?:{kind:"NO_REPLY"}}>)=>{const outcome=await handler(database as AppWiringMutationParticipant,prepared.claim);return outcome.reply===undefined?{value:outcome.value,noReply:{kind:"NO_REPLY"}}:{value:outcome.value,reply:{outboxId:"23",room:outcome.reply.destinationId,data:outcome.reply.data}};},
    runReadOnly:async(prepared:{claim:AppWiringClaim},handler:(database:AppWiringReadParticipant,claim:AppWiringClaim)=>Promise<{value:unknown}>)=>(await handler(database,prepared.claim)).value,
    runReject:async(prepared:{claim:AppWiringClaim},handler:(claim:AppWiringClaim)=>Promise<{value:unknown}>)=>(await handler(prepared.claim)).value,
    replayReadOnlyReply:async()=>({outboxId:"21",room:"room-1",data:"목록"}),
    replayMutationReply:async()=>({outboxId:"22",room:"room-1",data:"저장된 생성 응답"}),
    replayMutationIrisOutcome:async()=>replayStatus==="NO_REPLY"?{noReply:{kind:"NO_REPLY"}}:{reply:{outboxId:"23",room:"room-1",data:"저장된 판매 응답"}},
    fail:async()=>{},
  } as unknown as MariaAppWiringOperationProvider;
  const ingress=new PetTitleAppWiringIngress(
    provider,
    {resolveReadOnly:async()=>({route,reasonCode:baseClaim.reasonCode,handlerKey:"pet_title_lifecycle"})},
    {preview:async()=>{previewCalls+=1;return {authorized:true,resultFingerprint:"c".repeat(64),canonicalPlayerId:"player01",reply:"목록"};}},
    {resolveSelf:async()=>actor,resolveUniqueLegacyDisplayTarget:async()=>actor},
    {create:async(_database,_claim,input)=>{createCalls+=1;return input.titleName==="부족"
      ?{operationId:"petop001",operationType:"CREATE",outcomeCode:"INSUFFICIENT_TICKET",titleName:input.titleName,remainingTicketQuantity:0n,resultFingerprint:"c".repeat(64),replayedDomainState:false}
      :{operationId:"petop001",operationType:"CREATE",outcomeCode:"CREATED",ownedPetTitleId:"petown01",titleName:input.titleName,remainingTicketQuantity:1n,resultFingerprint:"c".repeat(64),replayedDomainState:false};},
     sell:async(_database,_claim,input)=>{sellCalls+=1;return input.index===9
       ?{operationId:"petop009",operationType:"SELL",outcomeCode:"NOT_FOUND",salePoint:0n,resultFingerprint:"c".repeat(64),replayedDomainState:false}
       :input.index===8
       ?{operationId:"petop008",operationType:"SELL",outcomeCode:"SILENT_CASTLE_ACTIVE",salePoint:0n,resultFingerprint:"c".repeat(64),replayedDomainState:false}
       :{operationId:"petop002",operationType:"SELL",outcomeCode:"SOLD",ownedPetTitleId:"petown01",titleName:"별빛",salePoint:30_000_000n,currencyOperationId:"currop01",balanceAfterMinorAmount:30_000_000_000n,resultFingerprint:"c".repeat(64),replayedDomainState:false};}},
  );
  return {ingress,previewCalls:()=>previewCalls,createCalls:()=>createCalls,sellCalls:()=>sellCalls};
}

describe("PET-TITLE app-wiring ingress routes",()=>{
  it("returns one persisted MODERN reply and replays it without re-reading",async()=>{
    const fresh=ingressFor("MODERN");
    assert.deepEqual(await fresh.ingress.handle(event("/펫타이틀목록")),{status:"modern",replayed:false,resultFingerprint:"c".repeat(64),reply:{outboxId:"21",room:"room-1",data:"목록"}});
    assert.equal(fresh.previewCalls(),1);
    const replay=ingressFor("MODERN",true);
    assert.deepEqual(await replay.ingress.handle(event("/펫타이틀목록")),{status:"modern",replayed:true,resultFingerprint:"c".repeat(64),reply:{outboxId:"21",room:"room-1",data:"목록"}});
    assert.equal(replay.previewCalls(),0);
  });

  it("keeps target MODERN on legacy until exact room/principal authority parity exists",async()=>{
    const fixture=ingressFor("MODERN");
    assert.deepEqual(await fixture.ingress.handle(event("/펫타이틀목록 대상회원")),{status:"legacy_fallback"});
    assert.equal(fixture.previewCalls(),0);
  });

  it("shadows selection but keeps MODERN selection on legacy until mutation reply atomicity is adopted",async()=>{
    const shadow=ingressFor("SHADOW");
    assert.deepEqual(await shadow.ingress.handle(event("/펫타이틀 2")),{status:"shadow",replayed:false,resultFingerprint:"c".repeat(64)});
    assert.equal(shadow.previewCalls(),1);
    const modern=ingressFor("MODERN");
    assert.deepEqual(await modern.ingress.handle(event("/펫타이틀 2")),{status:"legacy_fallback"});
    assert.equal(modern.previewCalls(),0);
  });

  it("executes SHADOW read-only and claims REJECT without a reply",async()=>{
    const shadow=ingressFor("SHADOW");
    assert.deepEqual(await shadow.ingress.handle(event("/펫타이틀목록")),{status:"shadow",replayed:false,resultFingerprint:"c".repeat(64)});
    assert.equal(shadow.previewCalls(),1);
    const rejected=ingressFor("REJECT");
    assert.deepEqual(await rejected.ingress.handle(event("/펫타이틀목록")),{status:"rejected",replayed:false,reasonCode:"AUTH_SCOPE_NOT_SATISFIED"});
    assert.equal(rejected.previewCalls(),0);
  });

  it("creates a title through the atomic MODERN mutation reply boundary",async()=>{
    const fixture=ingressFor("MODERN");
    const result=await fixture.ingress.handle(event("/펫타이틀이름 멋진 파트너"));
    assert.equal(result.status,"modern");
    if(result.status!=="modern")throw new Error("modern result required");
    assert.equal(result.reply.outboxId,"22");
    assert.equal(result.reply.data,"[👑호이] 님이 새로운 펫 타이틀을 생성완료!\n\n🎉 생성된 타이틀: [멋진 파트너]\n\n사용 아이템:\n 펫타이틀권🦊(/펫타이틀이름) -1 소모");
    assert.equal(fixture.createCalls(),1);
  });

  it("preserves the exact shortage reply and replays without another title creation",async()=>{
    const shortage=ingressFor("MODERN");
    const result=await shortage.ingress.handle(event("/펫타이틀이름 부족"));
    assert.equal(result.status,"modern");
    if(result.status!=="modern")throw new Error("modern result required");
    assert.equal(result.reply.data,"❌ 펫타이틀권🦊(/펫타이틀이름) 아이템이 부족합니다.");
    assert.equal(shortage.createCalls(),1);
    const replay=ingressFor("MODERN",true);
    assert.deepEqual(await replay.ingress.handle(event("/펫타이틀이름 멋진 파트너")),{status:"modern",replayed:true,resultFingerprint:"c".repeat(64),reply:{outboxId:"22",room:"room-1",data:"저장된 생성 응답"}});
    assert.equal(replay.createCalls(),0);
  });

  it("leaves SHADOW and overlength create requests on the exact legacy path",async()=>{
    const shadow=ingressFor("SHADOW");
    assert.deepEqual(await shadow.ingress.handle(event("/펫타이틀이름 새 타이틀")),{status:"legacy_fallback"});
    assert.equal(shadow.createCalls(),0);
    const modern=ingressFor("MODERN");
    assert.deepEqual(await modern.ingress.handle(event(`/펫타이틀이름 ${"가".repeat(21)}`)),{status:"legacy_fallback"});
    assert.equal(modern.createCalls(),0);
  });

  it("keeps sale SHADOW on legacy and adopts MODERN sale with exact reply and typed no-reply parity",async()=>{
    const shadow=ingressFor("SHADOW");
    assert.deepEqual(await shadow.ingress.handle(event("/펫타이틀판매 1")),{status:"legacy_fallback"});
    assert.equal(shadow.sellCalls(),0);
    const modern=ingressFor("MODERN");
    assert.deepEqual(await modern.ingress.handle(event("/펫타이틀판매 1")),{status:"modern",replayed:false,resultFingerprint:"c".repeat(64),reply:{outboxId:"23",room:"room-1",data:"[👑호이] 님의 펫 타이틀 [별빛] \n🅟30,000,000 포인트에 판매되었습니다."}});
    assert.equal(modern.sellCalls(),1);
    const soldReplay=ingressFor("MODERN",true);
    assert.deepEqual(await soldReplay.ingress.handle(event("/펫타이틀판매 1")),{status:"modern",replayed:true,resultFingerprint:"c".repeat(64),reply:{outboxId:"23",room:"room-1",data:"저장된 판매 응답"}});
    assert.equal(soldReplay.sellCalls(),0);
    const missing=ingressFor("MODERN");
    const missingResult=await missing.ingress.handle(event("/펫타이틀판매 9"));
    assert.equal(missingResult.status,"modern");
    if(missingResult.status!=="modern")throw new Error("modern result required");
    assert.equal(missingResult.reply.data,"해당 번호의 펫 타이틀이 존재하지 않습니다.");
    const silent=ingressFor("MODERN");
    assert.deepEqual(await silent.ingress.handle(event("/펫타이틀판매 8")),{status:"handled_no_reply",replayed:false,resultFingerprint:"c".repeat(64)});
    assert.equal(silent.sellCalls(),1);
    const silentReplay=ingressFor("MODERN",true,"NO_REPLY");
    assert.deepEqual(await silentReplay.ingress.handle(event("/펫타이틀판매 8")),{status:"handled_no_reply",replayed:true,resultFingerprint:"c".repeat(64)});
    assert.equal(silentReplay.sellCalls(),0);
    assert.deepEqual(await shadow.ingress.handle(event("/펫타이틀판매방법")),{status:"ignored"});
    assert.deepEqual(await shadow.ingress.handle(event("/펫타이틀판매 1 알려줘")),{status:"ignored"});
  });
});
