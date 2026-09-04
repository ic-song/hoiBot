import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppWiringClaim, AppWiringReadParticipant, MariaAppWiringOperationProvider } from "../src/dispatch/app-wiring-operation-provider.js";
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

const database: AppWiringReadParticipant = { query: async <T>() => [] as T };

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
});

function ingressFor(route:"MODERN"|"SHADOW"|"REJECT",replay=false){
  let previewCalls=0;
  const claim:AppWiringClaim={appWiringOperationId:"claim001",requestIdentityFingerprint:"a".repeat(64),requestNamespace:"hoibot:dev:hoi_bot",entrypointKind:"IRIS",externalRequestId:"pet-title-1",requestKey:"IRIS:pet-title-1",payloadFingerprint:"b".repeat(64),route,effectMode:"READ_ONLY",reasonCode:route==="REJECT"?"AUTH_SCOPE_NOT_SATISFIED":"CANARY",handlerKey:"pet_title_lifecycle",claimState:replay?"COMPLETED":"CLAIMED",...(replay?{result:{status:"REPLY_QUEUED",referenceId:"21",resultFingerprint:"c".repeat(64)}}:{})};
  const provider={
    prepare:async()=>replay?{claim,replayed:true as const}:{claim,replayed:false as const},
    runReadOnlyReply:async(_prepared:unknown,handler:(database:AppWiringReadParticipant,claim:AppWiringClaim)=>Promise<{value:unknown;reply:{destinationId:string;data:string}}>)=>{const outcome=await handler(database,claim);return {value:outcome.value,reply:{outboxId:"21",room:outcome.reply.destinationId,data:outcome.reply.data}};},
    runReadOnly:async(_prepared:unknown,handler:(database:AppWiringReadParticipant,claim:AppWiringClaim)=>Promise<{value:unknown}>)=>(await handler(database,claim)).value,
    runReject:async(_prepared:unknown,handler:(claim:AppWiringClaim)=>Promise<{value:unknown}>)=>(await handler(claim)).value,
    replayReadOnlyReply:async()=>({outboxId:"21",room:"room-1",data:"목록"}),
    fail:async()=>{},
  } as unknown as MariaAppWiringOperationProvider;
  const ingress=new PetTitleAppWiringIngress(provider,{resolveReadOnly:async()=>({route,effectMode:"READ_ONLY",reasonCode:claim.reasonCode,handlerKey:"pet_title_lifecycle"})},{preview:async()=>{previewCalls+=1;return {authorized:true,resultFingerprint:"c".repeat(64),canonicalPlayerId:"player01",reply:"목록"};}});
  return {ingress,previewCalls:()=>previewCalls};
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

  it("executes SHADOW read-only and claims REJECT without a reply",async()=>{
    const shadow=ingressFor("SHADOW");
    assert.deepEqual(await shadow.ingress.handle(event("/펫타이틀목록")),{status:"shadow",replayed:false,resultFingerprint:"c".repeat(64)});
    assert.equal(shadow.previewCalls(),1);
    const rejected=ingressFor("REJECT");
    assert.deepEqual(await rejected.ingress.handle(event("/펫타이틀목록")),{status:"rejected",replayed:false,reasonCode:"AUTH_SCOPE_NOT_SATISFIED"});
    assert.equal(rejected.previewCalls(),0);
  });
});
