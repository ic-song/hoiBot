import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MariaPetSkillInfoActorContextProvider } from "../src/pet/pet-skill-info-actor-context-provider.js";

function participant(responses: readonly unknown[]) {
  const calls: Array<{sql:string;values:readonly unknown[]}> = [];
  return {
    calls,
    database: { query: async <T>(sql:string, values:readonly unknown[] = []) => {
      calls.push({sql,values});
      const response=responses[calls.length-1];
      if(response===undefined)throw new Error("UNEXPECTED_QUERY");
      return response as T;
    }}
  };
}

const activeRow={legacy_player_id:22n,canonical_player_id:"pabc1234",external_identity_id:7n,display_name:"TT",rank_emoji:"♔",provider_code:"kakao",caller_link_id:"lcall123"};
const legacyRow={legacy_player_id:11n,canonical_player_id:"pleg1234",external_identity_id:5n,display_name:"AB",rank_emoji:null,provider_code:"kakao"};

describe("MariaPetSkillInfoActorContextProvider",()=>{
  it("Kakao 방 선택 계정과 대표계정 이용권 권위를 함께 고정한다",async()=>{
    const scripted=participant([[activeRow],[{portal_account_id:"porta123",platform_context_membership_id:"memb1234",selection_version:4n,representative_player_id:11n}]]);
    const result=await new MariaPetSkillInfoActorContextProvider().resolve(scripted.database,{identityProviderCode:"kakao",externalUserId:"room-user",externalContextId:"room-a"});
    assert.deepEqual(result,{selectionSource:"ACTIVE_CONTEXT",platformCode:"kakao",externalContextId:"room-a",externalIdentityId:"7",selectedLegacyPlayerId:"22",selectedCanonicalPlayerId:"pabc1234",entitlementLegacyPlayerId:"11",portalAccountId:"porta123",platformContextMembershipId:"memb1234",selectionVersion:"4"});
    assert.deepEqual(scripted.calls[1]!.values,["KAKAO","room-a","room-user","ROOM","room-a","22"]);
    assert.match(scripted.calls[1]!.sql,/context_row\.platform_code=platform_identity\.platform_code/);
    assert.match(scripted.calls[1]!.sql,/portal_account\.portal_account_status='ACTIVE'/);
    assert.match(scripted.calls[1]!.sql,/representative_link\.player_role='REPRESENTATIVE'/);
    assert.match(scripted.calls[1]!.sql,/representative_player\.status='active'/);
  });

  it("포털에 연결되지 않은 레거시는 자기 계정 이용권을 사용한다",async()=>{
    const scripted=participant([[],[legacyRow]]);
    const result=await new MariaPetSkillInfoActorContextProvider().resolve(scripted.database,{identityProviderCode:"kakao",externalUserId:"legacy-user",externalContextId:"room-b"});
    assert.equal(result.selectionSource,"LEGACY_CROSSWALK");
    assert.equal(result.selectedLegacyPlayerId,"11");
    assert.equal(result.entitlementLegacyPlayerId,"11");
    assert.equal(result.portalAccountId,null);
    assert.equal(result.selectionVersion,null);
    assert.equal(scripted.calls.length,2);
  });

  it("Discord는 계정 identity와 서버 context를 분리해 권위를 대사한다",async()=>{
    const row={...activeRow,provider_code:"discord"};
    const scripted=participant([[row],[{portal_account_id:"porta123",platform_context_membership_id:"memb1234",selection_version:"9",representative_player_id:"11"}]]);
    const result=await new MariaPetSkillInfoActorContextProvider().resolve(scripted.database,{identityProviderCode:"discord",externalUserId:"discord-user",externalContextId:"server-a"});
    assert.equal(result.platformCode,"discord");
    assert.deepEqual(scripted.calls[1]!.values,["DISCORD","PLATFORM_ACCOUNT","discord-user","SERVER","server-a","22"]);
  });

  it("대표계정·membership·selection 대사가 누락되거나 복수이면 fail-close 한다",async()=>{
    const missing=participant([[activeRow],[]]);
    await assert.rejects(()=>new MariaPetSkillInfoActorContextProvider().resolve(missing.database,{identityProviderCode:"kakao",externalUserId:"u",externalContextId:"r"}),/PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT/);
    const duplicate=participant([[activeRow],[{portal_account_id:"porta123",platform_context_membership_id:"memb1234",selection_version:1n,representative_player_id:1n},{portal_account_id:"portb123",platform_context_membership_id:"memb5678",selection_version:1n,representative_player_id:2n}]]);
    await assert.rejects(()=>new MariaPetSkillInfoActorContextProvider().resolve(duplicate.database,{identityProviderCode:"kakao",externalUserId:"u",externalContextId:"r"}),/PET_SKILL_INFO_ACTOR_CONTEXT_AMBIGUOUS/);
  });
});
