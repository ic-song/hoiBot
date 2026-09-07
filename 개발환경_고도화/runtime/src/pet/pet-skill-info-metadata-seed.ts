import type {DatabaseClient} from "../database.js";
import type {CanonicalPetSkillSeedProjection} from "./canonical-pet-skill-read-seed.js";

export class MariaPetSkillInfoMetadataSeeder{
  public constructor(private readonly database:DatabaseClient){}
  public async seed(input:{actor:string;projection:CanonicalPetSkillSeedProjection}):Promise<void>{
    if(input.projection.definitions.length!==93)throw new Error("PET_SKILL_INFO_METADATA_SOURCE_DRIFT");
    await this.database.withTransaction(async transaction=>{
      for(const row of input.projection.definitions){const raid=Number(row.source.raidExp??0),castle=Number(row.source.castleExp??0);if(!Number.isSafeInteger(raid)||raid<0||!Number.isSafeInteger(castle)||castle<0)throw new Error("PET_SKILL_INFO_METADATA_VALUE_INVALID");const result=await transaction.execute("UPDATE canonical_pet_skill_definitions SET raid_charm_bonus=?,castle_charm_bonus=?,UPDATE_USER=?,UPDATE_TIME=DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s') WHERE legacy_source_key=? AND active_flag=TRUE",[raid,castle,input.actor,row.sourceKey]);if(result.affectedRows!==1n)throw new Error("PET_SKILL_INFO_METADATA_CROSSWALK_INVALID");}
      const count=(await transaction.query<Array<{count_value:bigint}>>("SELECT COUNT(*) count_value FROM canonical_pet_skill_definitions WHERE active_flag=TRUE AND raid_charm_bonus IS NOT NULL AND castle_charm_bonus IS NOT NULL"))[0]?.count_value??0n;if(count!==93n)throw new Error("PET_SKILL_INFO_METADATA_COUNT_DRIFT");
    });
  }
}
