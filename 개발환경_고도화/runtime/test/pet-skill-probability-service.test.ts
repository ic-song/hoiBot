import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient, ReadOnlySnapshotTransaction } from "../src/database.js";
import { formatLegacyPetSkillProbability, isPetSkillProbabilityCommand, PetSkillProbabilityService } from "../src/pet/pet-skill-probability-service.js";
import type { CanonicalPetSkillReadDefinition } from "../src/pet/canonical-pet-skill-read-provider.js";

const definition = (name: string, grade: string, rate: number, displayOrder: number): CanonicalPetSkillReadDefinition => ({
  petSkillId: `skill00${displayOrder}`, name, description: "효과", grade, gradeEmoji: "📙",
  legacySourceKey: `skill_${displayOrder}`, displayOrder, baseDrawRate: rate, actualRate: rate,
  fixedDrawRate: true, openable: true, requiredTierName: null, tierExclusive: false,
  equipDescription: null, handlerKey: "presentation_only", options: {}, aliases: []
});

describe("pet skill probability actual ingress service", () => {
  it("accepts only the exact command and keeps aggregate/info out of scope", () => {
    assert.equal(isPetSkillProbabilityCommand("/펫스킬확률"), true);
    for (const message of ["/펫스킬", "/펫스킬정보", "/펫스킬확률 ", "/펫스킬확률 1", undefined]) {
      assert.equal(isPetSkillProbabilityCommand(message), false);
    }
  });

  it("formats exact legacy bytes including aliases, emoji, sections, folding, and line breaks", () => {
    const actual = formatLegacyPetSkillProbability([
      definition("[펫스킬북]하느님위에갓물주✨", "SS", 0.2, 1),
      definition("광산 탐험가📙", "A", 99.8, 2)
    ]);
    const expected = `📙 펫스킬북 확률표 📙\n\n${"\u200b".repeat(500)}\n━━━SS 등급━━━\n하느님 위에 갓물주📙 (확률: 0.2%)\n\n━━━S 등급━━━\n\n━━━A 등급━━━\n광산탐험가📙 (확률: 99.8%)\n\n━━━B 등급━━━\n\n━━━C 등급━━━\n\n━━━D 등급━━━\n\n━━━━━━━━━━━━━━━\n총 확률: 100.0%`;
    assert.equal(actual, expected);
    assert.match(formatLegacyPetSkillProbability([definition("🐉 용용용의 여의주", "S", 100, 1)]), /🐉 용용용의 여의주📙/);
  });

  it("reads actor and canonical catalog in one query-only snapshot", async () => {
    const queries: string[] = [];
    const definitionRows = [{ pet_skill_id:"skill001",pet_skill_name:"테스트",pet_skill_description:"효과",pet_skill_grade:"SS",legacy_source_key:"skill_000",display_order:1,base_draw_rate:"100",fixed_draw_rate_flag:1,openable_flag:1,pet_skill_grade_emoji:"📙",required_tier_name:null,tier_exclusive_flag:0,equip_description:null,handler_key:"presentation_only",options_json:{},active_flag:1 }];
    const snapshot: ReadOnlySnapshotTransaction = { query: async <T>(sql: string, values?: readonly unknown[]) => {
      queries.push(`${sql}\n${JSON.stringify(values ?? [])}`);
      if (sql.includes("FROM external_identities")) return [{ player_status: "active" }] as T;
      if (sql.includes("canonical_pet_skill_aliases")) return [] as T;
      if (sql.includes("canonical_pet_skill_draw_grade_policies")) return [] as T;
      return definitionRows as T;
    }};
    const unsupported = async () => { throw new Error("mutable path must not run"); };
    const database = { ping:unsupported,verifyRollback:unsupported,query:unsupported,execute:unsupported,withTransaction:unsupported,close:unsupported,withControlledTransaction:unsupported,
      withReadOnlySnapshot: async <T>(work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>) => work(snapshot) } as unknown as DatabaseClient;
    const result = await new PetSkillProbabilityService(database).read({ externalUserId: "actor-1", displayName: "호이 남" });
    assert.match(result?.reply ?? "", /^📙 펫스킬북 확률표 📙/);
    assert.equal(queries.length, 4);
    assert.ok(queries.every((query) => query.startsWith("SELECT ")));
    assert.match(queries[0]!, /external_user_id=\?/);
    assert.match(queries[0]!, /\["actor-1"\]$/);
  });

  it("fails closed for duplicate identity and preserves legacy suspension response", async () => {
    const databaseFor = (actors: readonly { player_status: string }[]) => ({
      ping: async()=>undefined, verifyRollback:async()=>true, query:async()=>[], execute:async()=>({affectedRows:0n,insertId:0n}),
      withTransaction:async()=>{throw new Error("mutable path must not run");}, close:async()=>undefined, withControlledTransaction:async()=>{throw new Error("mutable path must not run");},
      withReadOnlySnapshot: async <T>(work: (transaction: ReadOnlySnapshotTransaction) => Promise<T>) => work({query:async<R>()=>actors as R})
    } as unknown as DatabaseClient);
    await assert.rejects(new PetSkillProbabilityService(databaseFor([{player_status:"active"},{player_status:"active"}])).read({externalUserId:"dup",displayName:"중복"}),/IDENTITY_DUPLICATE/);
    assert.deepEqual(await new PetSkillProbabilityService(databaseFor([{player_status:"suspended"}])).read({externalUserId:"stop",displayName:"정지"}),{reply:"계정정지 상태입니다 호월고객센터로 문의해주세요"});
    assert.equal(await new PetSkillProbabilityService(databaseFor([])).read({externalUserId:"missing",displayName:"미가입"}),null);
    assert.equal(await new PetSkillProbabilityService(databaseFor([{player_status:"active"}])).read({externalUserId:"long",displayName:"다섯글자임"}),null);
  });
});
