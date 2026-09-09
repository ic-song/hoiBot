import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { createObjectAuditValues, createObjectIdentityCandidate, type ObjectIdentityCandidateGenerator } from "../identity/object-identity-audit-provider.js";
import { insertWithCuid8CollisionRetry } from "../shared/maria-database-error-policy.js";
import { LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256 } from "../inventory/legacy-rank-label-runtime-source-contract.js";
import { calculateLegacyRankLabelCertificateFingerprint, calculateLegacyRankLabelCertificateSetSha256, calculateLegacyRankLabelMembershipSemanticSha256, calculateLegacyRankLabelValidationFingerprint, canonicalLegacyRankLabel, legacyRankLabelSha256 } from "../inventory/legacy-rank-label-side-effect-certificate-contract.js";

export const LEGACY_RANK_LABEL_PROJECTION_VERSION = "LEGACY_RANK_LABEL_SIDE_EFFECT_V1" as const;
type JsonObject = Record<string, unknown>;
type Decision = "NO_WRITE" | "WOULD_DELETE" | "UNMAPPED";

interface RawRow { raw_landing_run_id:string; run_status:string; bundle_sha256:string; snapshot_manifest_sha256:string; source_path_sha256:string; source_content_sha256:string; payload:Buffer|string; }
interface BindingRow { source_player_key_sha256:string; player_id:string; }
interface ImportBindingRow { object_domain_import_run_id:string; catalog_projection_run_id:string; common_staging_run_id:string; run_status:string; raw_bundle_sha256:string; snapshot_manifest_sha256:string; }
interface MarkerRow { assignment_status:string; source_fingerprint:string; player_id:string|null; }
interface ExistingRow { legacy_rank_label_validation_run_id:string; validation_fingerprint:string; certificate_set_sha256:string; run_status:string; active_flag:number|boolean; }

export interface LegacyRankLabelCertificateProjectionInput {
  rawLandingRunId:string;
  objectDomainImportRunId:string;
  memberSourcePathSha256:string;
  guildSourcePathSha256:string;
  actor:string;
}
export interface LegacyRankLabelCertificateProjectionResult { validationRunId:string; status:"COMPLETE"|"REJECTED"; expectedSubjectCount:number; wouldDeleteCount:number; unmappedCount:number; replayed:boolean; }

const sha=legacyRankLabelSha256;
const canonical=canonicalLegacyRankLabel;
const object=(value:unknown):JsonObject|undefined=>typeof value==="object"&&value!==null&&!Array.isArray(value)?value as JsonObject:undefined;
// Rhino/JavaScript 조건문과 동일하게 JSON primitive의 truthiness를 판정한다.
const truthy=(value:unknown):boolean=>Boolean(value);
const hash64=(value:string,code:string):void=>{if(!/^[0-9a-f]{64}$/.test(value))throw new Error(code);};
export interface LegacyGuildPointerClassification { readonly guildPointerState:"NONE"|"VALID"|"STALE_GUILD"|"MEMBER_MISMATCH"; readonly sideEffectDecision:"NO_WRITE"|"WOULD_DELETE"; readonly membershipEvidence:unknown; }
export function classifyLegacyGuildPointer(memberValue:unknown,guildsValue:unknown,sourcePlayerKey:string):LegacyGuildPointerClassification{
  const member=object(memberValue),guilds=object(guildsValue),guildPointer=member?.guild,guildId=object(guildPointer)?.id;
  if(!member||!truthy(guildPointer)||!truthy(guildId))return{guildPointerState:"NONE",sideEffectDecision:"NO_WRITE",membershipEvidence:null};
  const guild=object(guilds?.[String(guildId)]);
  if(!guild)return{guildPointerState:"STALE_GUILD",sideEffectDecision:"WOULD_DELETE",membershipEvidence:null};
  const guildMembers=object(guild.members),evidence=guildMembers?.[sourcePlayerKey];
  if(!truthy(guild.members)||!guildMembers||!truthy(evidence))return{guildPointerState:"MEMBER_MISMATCH",sideEffectDecision:"WOULD_DELETE",membershipEvidence:null};
  return{guildPointerState:"VALID",sideEffectDecision:"NO_WRITE",membershipEvidence:evidence};
}

export class LegacyRankLabelSideEffectCertificateProjector {
  constructor(private readonly database:DatabaseClient,private readonly generate:ObjectIdentityCandidateGenerator=createObjectIdentityCandidate,private readonly now:()=>Date=()=>new Date()){}

  async project(input:LegacyRankLabelCertificateProjectionInput):Promise<LegacyRankLabelCertificateProjectionResult>{
    hash64(input.memberSourcePathSha256,"LEGACY_RANK_LABEL_MEMBER_PATH_HASH_INVALID");
    hash64(input.guildSourcePathSha256,"LEGACY_RANK_LABEL_GUILD_PATH_HASH_INVALID");
    if(input.memberSourcePathSha256===input.guildSourcePathSha256)throw new Error("LEGACY_RANK_LABEL_SOURCE_PATHS_NOT_DISTINCT");
    const audit=createObjectAuditValues(input.actor,this.now());
    return this.database.withTransaction(async tx=>{
      const imports=await tx.query<ImportBindingRow[]>(`SELECT import_run.object_domain_import_run_id,import_run.catalog_projection_run_id,staging.common_staging_run_id,import_run.run_status,staging.raw_bundle_sha256,staging.snapshot_manifest_sha256
        FROM data_migration_object_domain_import_runs import_run
        JOIN data_migration_catalog_projection_runs catalog ON catalog.catalog_projection_run_id=import_run.catalog_projection_run_id
        JOIN data_migration_common_staging_runs staging ON staging.common_staging_run_id=catalog.common_staging_run_id
        WHERE import_run.object_domain_import_run_id=? AND import_run.run_status='COMPLETE' AND catalog.run_status='COMPLETE' AND staging.run_status='COMPLETE' FOR UPDATE`,[input.objectDomainImportRunId]);
      if(imports.length!==1)throw new Error("LEGACY_RANK_LABEL_IMPORT_BINDING_NOT_COMPLETE");
      const raw=await tx.query<RawRow[]>(`SELECT run_row.raw_landing_run_id,run_row.run_status,run_row.bundle_sha256,run_row.snapshot_manifest_sha256,file_row.source_path_sha256,file_row.source_content_sha256,file_row.payload
        FROM data_migration_raw_runs run_row JOIN data_migration_raw_files file_row ON file_row.raw_landing_run_id=run_row.raw_landing_run_id
        WHERE run_row.raw_landing_run_id=? AND file_row.source_path_sha256 IN (?,?) ORDER BY file_row.source_path_sha256 FOR UPDATE`,[input.rawLandingRunId,input.memberSourcePathSha256,input.guildSourcePathSha256]);
      if(raw.length!==2||raw.some(row=>row.run_status!=="COMPLETE"))throw new Error("LEGACY_RANK_LABEL_RAW_SNAPSHOT_INCOMPLETE");
      if(imports[0]!.raw_bundle_sha256!==raw[0]!.bundle_sha256||imports[0]!.snapshot_manifest_sha256!==raw[0]!.snapshot_manifest_sha256)throw new Error("LEGACY_RANK_LABEL_SNAPSHOT_BINDING_MISMATCH");
      for(const row of raw){const bytes=Buffer.isBuffer(row.payload)?row.payload:Buffer.from(row.payload);if(sha(bytes)!==row.source_content_sha256)throw new Error("LEGACY_RANK_LABEL_RAW_CONTENT_DRIFT");}
      const memberRow=raw.find(row=>row.source_path_sha256===input.memberSourcePathSha256)!;
      const guildRow=raw.find(row=>row.source_path_sha256===input.guildSourcePathSha256)!;
      const parse=(row:RawRow,code:string):JsonObject=>{try{const value=JSON.parse((Buffer.isBuffer(row.payload)?row.payload:Buffer.from(row.payload)).toString("utf8"));const result=object(value);if(!result)throw new Error(code);return result;}catch{throw new Error(code);}};
      const memberRoot=parse(memberRow,"LEGACY_RANK_LABEL_MEMBER_JSON_INVALID"),guildRoot=parse(guildRow,"LEGACY_RANK_LABEL_GUILD_JSON_INVALID");
      const members=object(memberRoot.member); if(!members)throw new Error("LEGACY_RANK_LABEL_MEMBER_ROOT_INVALID");
      const guilds=object(guildRoot.guilds); if(!guilds)throw new Error("LEGACY_RANK_LABEL_GUILD_ROOT_INVALID");
      const lord=object(memberRoot.HoiCastle)?.lord;
      const subjects=[...new Set([...Object.keys(members),...(typeof lord==="string"&&lord!==""?[lord]:[])])].sort();
      const bindings=await tx.query<BindingRow[]>(`SELECT staging.owner_locator_sha256 source_player_key_sha256,receipt.target_pk_value player_id
        FROM data_migration_object_domain_import_records receipt
        JOIN data_migration_catalog_projection_records projection ON projection.catalog_projection_record_id=receipt.catalog_projection_record_id
        JOIN data_migration_catalog_source_decisions decision ON decision.catalog_source_decision_id=projection.catalog_source_decision_id
        JOIN data_migration_common_staging_records staging ON staging.common_staging_record_id=decision.common_staging_record_id
        WHERE receipt.object_domain_import_run_id=? AND projection.catalog_projection_run_id=? AND decision.catalog_projection_run_id=projection.catalog_projection_run_id
          AND staging.common_staging_run_id=? AND staging.source_path_sha256=?
          AND receipt.target_table_name='canonical_players' AND receipt.target_pk_column_name='player_id' AND staging.owner_locator_sha256 IS NOT NULL
        ORDER BY staging.owner_locator_sha256,receipt.target_pk_value FOR UPDATE`,[input.objectDomainImportRunId,imports[0]!.catalog_projection_run_id,imports[0]!.common_staging_run_id,input.memberSourcePathSha256]);
      const bySourceHash=new Map<string,string[]>();for(const row of bindings)bySourceHash.set(row.source_player_key_sha256,[...(bySourceHash.get(row.source_player_key_sha256)??[]),row.player_id]);
      const marker=(await tx.query<MarkerRow[]>("SELECT assignment_status,source_fingerprint,player_id FROM player_pet_skill_rank_marker_projections WHERE active_flag=TRUE AND marker_kind='CASTLE_LORD' FOR UPDATE"));
      if(marker.length!==1||!/^[0-9a-f]{64}$/.test(marker[0]!.source_fingerprint))throw new Error("LEGACY_RANK_LABEL_CASTLE_MARKER_INVALID");
      const certificates=subjects.map(name=>{
        const member=object(members[name]),guildPointer=member?.guild,classification=classifyLegacyGuildPointer(member,guilds,name);
        const state=classification.guildPointerState;let decision:Decision=classification.sideEffectDecision;
        const matches=[...new Set(bySourceHash.get(sha(name))??[])];if(matches.length!==1&&decision==="NO_WRITE")decision="UNMAPPED";
        const base={sourcePlayerKeySha256:sha(name),playerId:matches.length===1?matches[0]!:null,memberPresenceState:member?"PRESENT":"ABSENT",guildPointerState:state,sideEffectDecision:decision,guildPointerFingerprint:sha(canonical(guildPointer??null)),membershipEvidenceFingerprint:sha(canonical(classification.membershipEvidence))};
        return {...base,certificateFingerprint:calculateLegacyRankLabelCertificateFingerprint(base)};
      });
      const membershipSemanticSha256=calculateLegacyRankLabelMembershipSemanticSha256(certificates);
      const certificateSetSha256=calculateLegacyRankLabelCertificateSetSha256(certificates);
      const counts={noWrite:certificates.filter(row=>row.sideEffectDecision==="NO_WRITE").length,wouldDelete:certificates.filter(row=>row.sideEffectDecision==="WOULD_DELETE").length,unmapped:certificates.filter(row=>row.sideEffectDecision==="UNMAPPED").length};
      const status=counts.wouldDelete===0&&counts.unmapped===0?"COMPLETE":"REJECTED" as const;
      const fingerprint=calculateLegacyRankLabelValidationFingerprint({rawLandingRunId:input.rawLandingRunId,commonStagingRunId:imports[0]!.common_staging_run_id,objectDomainImportRunId:input.objectDomainImportRunId,memberSourcePathSha256:input.memberSourcePathSha256,memberSourceContentSha256:memberRow.source_content_sha256,guildSourcePathSha256:input.guildSourcePathSha256,guildSourceContentSha256:guildRow.source_content_sha256,rankMarkerSourceFingerprint:marker[0]!.source_fingerprint,legacyRuntimeSourceSha256:LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256,membershipSemanticSha256,certificateSetSha256,counts,status,projectionVersion:LEGACY_RANK_LABEL_PROJECTION_VERSION});
      const existing=await tx.query<ExistingRow[]>("SELECT legacy_rank_label_validation_run_id,validation_fingerprint,certificate_set_sha256,run_status,active_flag FROM legacy_rank_label_validation_runs WHERE raw_landing_run_id=? AND object_domain_import_run_id=? AND projection_version=? FOR UPDATE",[input.rawLandingRunId,input.objectDomainImportRunId,LEGACY_RANK_LABEL_PROJECTION_VERSION]);
      if(existing.length>0){const row=existing[0]!;if(existing.length!==1||row.validation_fingerprint!==fingerprint||row.certificate_set_sha256!==certificateSetSha256||row.run_status!==status||Boolean(row.active_flag)!==(status==="COMPLETE"))throw new Error("LEGACY_RANK_LABEL_CERTIFICATE_REPLAY_DRIFT");return{validationRunId:row.legacy_rank_label_validation_run_id,status,expectedSubjectCount:subjects.length,wouldDeleteCount:counts.wouldDelete,unmappedCount:counts.unmapped,replayed:true};}
      const runId=await this.insertId(tx,"INSERT INTO legacy_rank_label_validation_runs(legacy_rank_label_validation_run_id,raw_landing_run_id,common_staging_run_id,object_domain_import_run_id,projection_version,member_source_path_sha256,member_source_content_sha256,guild_source_path_sha256,guild_source_content_sha256,rank_marker_source_fingerprint,legacy_runtime_source_sha256,membership_semantic_sha256,certificate_set_sha256,validation_fingerprint,expected_subject_count,no_write_count,would_delete_count,unmapped_count,run_status,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",candidate=>[candidate,input.rawLandingRunId,imports[0]!.common_staging_run_id,input.objectDomainImportRunId,LEGACY_RANK_LABEL_PROJECTION_VERSION,input.memberSourcePathSha256,memberRow.source_content_sha256,input.guildSourcePathSha256,guildRow.source_content_sha256,marker[0]!.source_fingerprint,LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256,membershipSemanticSha256,certificateSetSha256,fingerprint,subjects.length,counts.noWrite,counts.wouldDelete,counts.unmapped,status,false,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
      for(const row of certificates)await this.insertId(tx,"INSERT INTO legacy_rank_label_side_effect_certificates(legacy_rank_label_side_effect_certificate_id,legacy_rank_label_validation_run_id,player_id,source_player_key_sha256,member_presence_state,guild_pointer_state,side_effect_decision,guild_pointer_fingerprint,membership_evidence_fingerprint,certificate_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",candidate=>[candidate,runId,row.playerId,row.sourcePlayerKeySha256,row.memberPresenceState,row.guildPointerState,row.sideEffectDecision,row.guildPointerFingerprint,row.membershipEvidenceFingerprint,row.certificateFingerprint,audit.INSERT_USER,audit.INSERT_TIME,audit.UPDATE_USER,audit.UPDATE_TIME]);
      if(status==="COMPLETE"){await tx.execute("UPDATE legacy_rank_label_validation_runs SET active_flag=FALSE,UPDATE_USER=?,UPDATE_TIME=? WHERE active_flag=TRUE",[audit.UPDATE_USER,audit.UPDATE_TIME]);const activated=await tx.execute("UPDATE legacy_rank_label_validation_runs SET active_flag=TRUE,UPDATE_USER=?,UPDATE_TIME=? WHERE legacy_rank_label_validation_run_id=? AND run_status='COMPLETE' AND would_delete_count=0 AND unmapped_count=0",[audit.UPDATE_USER,audit.UPDATE_TIME,runId]);if(activated.affectedRows!==1n)throw new Error("LEGACY_RANK_LABEL_CERTIFICATE_ACTIVATION_FAILED");}
      return{validationRunId:runId,status,expectedSubjectCount:subjects.length,wouldDeleteCount:counts.wouldDelete,unmappedCount:counts.unmapped,replayed:false};
    });
  }

  async rollback(validationRunId:string):Promise<void>{await this.database.withTransaction(async tx=>{const row=await tx.query<Array<{active_flag:number|boolean}>>("SELECT active_flag FROM legacy_rank_label_validation_runs WHERE legacy_rank_label_validation_run_id=? FOR UPDATE",[validationRunId]);if(row.length!==1)throw new Error("LEGACY_RANK_LABEL_CERTIFICATE_RUN_NOT_FOUND");if(Boolean(row[0]!.active_flag))throw new Error("LEGACY_RANK_LABEL_ACTIVE_CERTIFICATE_ROLLBACK_FORBIDDEN");await tx.execute("DELETE FROM legacy_rank_label_validation_runs WHERE legacy_rank_label_validation_run_id=?",[validationRunId]);});}
  private insertId(tx:DatabaseTransaction,sql:string,values:(candidate:string)=>readonly unknown[]):Promise<string>{return insertWithCuid8CollisionRetry(async candidate=>{await tx.execute(sql,values(candidate));},{generate:this.generate,exhaustedErrorCode:"LEGACY_RANK_LABEL_CUID_COLLISION_RETRY_EXHAUSTED"});}
}
