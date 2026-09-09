import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";
import { MariaCanonicalPetSkillReadProvider } from "../src/pet/canonical-pet-skill-read-provider.js";
import { fingerprintPetSkillInfoBagStacks, fingerprintPetSkillInfoCatalog, PetSkillInfoShadowService } from "../src/pet/pet-skill-info-shadow-service.js";

const config=loadConfig();
if(!config.database.enabled)throw new Error("DATABASE_ENABLED must be true");
if(!/^hoibot_wbs764_admin_bag_projection$/i.test(config.database.name))throw new Error(`Synthetic WBS764 probe blocked: ${config.database.name}`);
const database=createDatabaseClient(config.database),verifyRestart=process.argv.includes("--verify-restart");
const actorId=976400001n,targetId=976400002n,identityId=976400003n,operatorId=976400004n;
const now="2026-09-07 17:30:00",source="c".repeat(64),catalogProjection="d".repeat(64);

async function evaluate(){return new PetSkillInfoShadowService(database).evaluate({externalUserId:"wbs764-admin",externalChannelId:"wbs764-room",displayName:"호이 남",message:"/펫스킬정보 대상"});}

try{
  if(!verifyRestart){
    await database.execute("INSERT INTO players(id,status) VALUES (?, 'active'),(?, 'active')",[actorId,targetId]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,'호이 남'),(?,'대상')",[actorId,targetId]);
    await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'🐣',1),(?,'🐣',2)",[actorId,targetId]);
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,status) VALUES (?,?,'kakao','wbs764-admin','linked')",[identityId,actorId]);
    await database.execute("INSERT INTO admin_operators(id,login_id,display_name,password_hash,status) VALUES (?,'wbs764-admin','호이 남','synthetic','active')",[operatorId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)",[operatorId,identityId]);
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) SELECT ?,id FROM admin_roles WHERE code='manager'",[operatorId]);
    await database.execute("INSERT INTO channels(provider_code,external_channel_id,channel_type,status) VALUES ('kakao','wbs764-room','group','active')");
    await database.execute("INSERT INTO canonical_players(player_id,source_system,source_identifier,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('w764tgt1','LEGACY_DB',?,'wbs764',?,'wbs764',?)",[targetId.toString(),now,now]);
    await database.execute("INSERT INTO pet_skill_info_admin_channel_authorities(pet_skill_info_admin_channel_authority_id,provider_code,external_channel_id,operator_scope,authority_decision,active_flag,revision,source_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('w764aut1','kakao','wbs764-room','ADMIN','ALLOW',TRUE,1,REPEAT('a',64),'wbs764',?,'wbs764',?)",[now,now]);
    const kinds=["CASTLE_LORD","STAR","CARROT","THERMO","MINI_PET","TOP_LEVEL","MC","INTIMACY"];
    for(let index=0;index<kinds.length;index+=1)await database.execute("INSERT INTO player_pet_skill_rank_marker_projections(player_pet_skill_rank_marker_projection_id,player_id,marker_kind,marker_priority,assignment_status,source_fingerprint,revision,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?, ?, ?, ?, ?, REPEAT('b',64),1,TRUE,'wbs764',?,'wbs764',?)",[`w764m00${index+1}`,index===1?"w764tgt1":null,kinds[index],index+1,index===1?"ASSIGNED":"UNASSIGNED",now,now]);
    await database.execute("INSERT INTO data_migration_common_staging_runs(common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,staging_sha256,expected_file_count,expected_total_bytes,expected_record_count,projected_file_count,ignored_file_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('w764stg1',REPEAT('1',64),REPEAT('2',64),REPEAT('3',64),REPEAT('4',64),1,1,93,1,0,'COMPLETE','wbs764',?,'wbs764',?)",[now,now]);
    await database.execute("INSERT INTO data_migration_catalog_projection_runs(catalog_projection_run_id,common_staging_run_id,raw_bundle_sha256,snapshot_manifest_sha256,extraction_manifest_sha256,expected_file_count,expected_total_bytes,projected_file_count,ignored_file_count,upstream_envelope_sha256,catalog_version,projection_manifest_sha256,target_schema_sha256,projection_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,projected_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('w764cat1','w764stg1',REPEAT('1',64),REPEAT('2',64),REPEAT('3',64),1,1,1,0,REPEAT('4',64),'WBS764',REPEAT('5',64),REPEAT('6',64),?,93,93,0,0,93,'COMPLETE','wbs764',?,'wbs764',?)",[catalogProjection,now,now]);
    await database.execute("INSERT INTO data_migration_object_domain_import_runs(object_domain_import_run_id,catalog_projection_run_id,catalog_version,catalog_projection_sha256,upstream_envelope_sha256,target_schema_sha256,import_contract_sha256,import_sha256,expected_source_count,projected_source_count,quarantined_source_count,ignored_source_count,expected_row_count,imported_row_count,run_status,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('w764imp1','w764cat1','WBS764',?,REPEAT('7',64),REPEAT('8',64),REPEAT('9',64),?,93,93,0,0,93,93,'COMPLETE','wbs764',?,'wbs764',?)",[catalogProjection,source,now,now]);
    const catalog=await new MariaCanonicalPetSkillReadProvider(database).readCatalog(),skill=catalog.definitions[0]!;
    await database.execute("INSERT INTO canonical_owned_pet_skill_stacks(owned_pet_skill_id,player_id,pet_skill_id,quantity,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('w764stk1','w764tgt1',?,3,'wbs764',?,'wbs764',?)",[skill.petSkillId,now,now]);
    const stack=[{owned_pet_skill_id:"w764stk1",pet_skill_id:skill.petSkillId,legacy_source_key:skill.legacySourceKey,pet_skill_name:skill.name,pet_skill_grade:skill.grade,display_order:skill.displayOrder,quantity:3n}];
    await database.execute("INSERT INTO player_pet_skill_bag_import_completeness_projections(player_pet_skill_bag_import_completeness_projection_id,player_id,object_domain_import_run_id,expected_source_key_count,projected_stack_count,quarantined_source_key_count,ignored_source_key_count,source_fingerprint,catalog_projection_sha256,catalog_set_fingerprint,stack_set_fingerprint,revision,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES ('w764cmp1','w764tgt1','w764imp1',1,1,0,0,?,?,?,?,1,TRUE,'wbs764',?,'wbs764',?)",[source,catalogProjection,fingerprintPetSkillInfoCatalog(catalog.definitions),fingerprintPetSkillInfoBagStacks(stack),now,now]);
    const result=await evaluate();assert.equal(result?.status,"shadow");assert.match(result.status==="shadow"?result.reply:"",/^\[💞대상\] 보유 스킬가방📙\[3\/100\]/);assert.match(result.status==="shadow"?result.reply:"",/1\..*\[.+\] x3$/s);
    await database.execute("UPDATE canonical_owned_pet_skill_stacks SET quantity=4 WHERE owned_pet_skill_id='w764stk1'");
    assert.deepEqual(await evaluate(),{status:"legacy_fallback",reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"});
    await database.execute("UPDATE canonical_owned_pet_skill_stacks SET quantity=3 WHERE owned_pet_skill_id='w764stk1'");
  }
  const replay=await evaluate();assert.equal(replay?.status,"shadow");
  const counts=(await database.query<Array<{authority_count:bigint;marker_count:bigint;completeness_count:bigint;stack_count:bigint}>>("SELECT (SELECT COUNT(*) FROM pet_skill_info_admin_channel_authorities) authority_count,(SELECT COUNT(*) FROM player_pet_skill_rank_marker_projections) marker_count,(SELECT COUNT(*) FROM player_pet_skill_bag_import_completeness_projections) completeness_count,(SELECT COUNT(*) FROM canonical_owned_pet_skill_stacks WHERE player_id='w764tgt1') stack_count"))[0]!;
  assert.deepEqual(counts,{authority_count:1n,marker_count:8n,completeness_count:1n,stack_count:1n});
  process.stdout.write(JSON.stringify({mode:verifyRestart?"verify-restart":"probe",authority:1,markerSlots:8,completeness:1,stack:1,exactOutput:true,tamperFailClosed:true,operationalDataTouched:false})+"\n");
}finally{await database.close();}
