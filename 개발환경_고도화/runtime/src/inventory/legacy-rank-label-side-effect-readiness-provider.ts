import type { PlayerContext } from "../account-platform/player-context-provider.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import { LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256 } from "./legacy-rank-label-runtime-source-contract.js";
import { calculateLegacyRankLabelCertificateFingerprint, calculateLegacyRankLabelCertificateSetSha256, calculateLegacyRankLabelMembershipSemanticSha256, calculateLegacyRankLabelValidationFingerprint, type LegacyRankLabelCertificateFields } from "./legacy-rank-label-side-effect-certificate-contract.js";

export interface LegacyRankLabelSideEffectReadiness {
  readonly ready:boolean;
  readonly reasonCode:"READY"|"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN";
  readonly validationRunId?:string;
}

interface ReadinessRow {
  legacy_rank_label_validation_run_id:string;
  object_domain_import_run_id:string;
  raw_landing_run_id:string;
  member_source_content_sha256:string;
  guild_source_content_sha256:string;
  rank_marker_source_fingerprint:string;
  membership_semantic_sha256:string;
  projection_version:string;
  run_status:string;
  expected_subject_count:number|string|bigint;
  no_write_count:number|string|bigint;
  would_delete_count:number|string|bigint;
  unmapped_count:number|string|bigint;
  validation_fingerprint:string;
  legacy_runtime_source_sha256:string;
  certificate_set_sha256:string;
  current_decision:string|null;
  current_presence:string|null;
  current_certificate_fingerprint:string|null;
  current_source_player_key_sha256:string|null; current_player_id:string|null; current_guild_pointer_state:string|null; current_guild_pointer_fingerprint:string|null; current_membership_evidence_fingerprint:string|null;
  castle_assignment_status:string;
  castle_player_id:string|null;
  castle_marker_fingerprint:string;
  castle_decision:string|null;
  castle_certificate_fingerprint:string|null;
  castle_source_player_key_sha256:string|null; castle_certificate_player_id:string|null; castle_presence:string|null; castle_guild_pointer_state:string|null; castle_guild_pointer_fingerprint:string|null; castle_membership_evidence_fingerprint:string|null;
  completeness_projection_version:string;
  completeness_revision:number|string|bigint;
  completeness_fingerprint:string;
  raw_member_content_match:number|string|bigint;
  raw_guild_content_match:number|string|bigint;
  actual_certificate_count:number|string|bigint; actual_no_write_count:number|string|bigint; actual_would_delete_count:number|string|bigint; actual_unmapped_count:number|string|bigint;
  actual_certificate_set_sha256:string|null;
  all_certificate_rows:string|null;
}
const hash=(value:string|null):boolean=>value!==null&&/^[0-9a-f]{64}$/.test(value);
const integer=(value:number|string|bigint):bigint=>BigInt(value);
interface VerifiedCertificate extends LegacyRankLabelCertificateFields {readonly certificateFingerprint:string;readonly identityPlayerCount:bigint;readonly identityMatchCount:bigint;}
const parseCertificates=(serialized:string|null):VerifiedCertificate[]=>serialized===null?[]:serialized.split("\n").map(line=>{
  const columns=line.split("|");if(columns.length!==10)throw new Error("LEGACY_RANK_LABEL_CERTIFICATE_SERIALIZATION_INVALID");
  return{sourcePlayerKeySha256:columns[0]!,playerId:columns[1]||null,memberPresenceState:columns[2]!,guildPointerState:columns[3]!,sideEffectDecision:columns[4]!,guildPointerFingerprint:columns[5]!,membershipEvidenceFingerprint:columns[6]!,certificateFingerprint:columns[7]!,identityPlayerCount:BigInt(columns[8]!),identityMatchCount:BigInt(columns[9]!)};
});

// WBS776은 이 결과가 false이거나 query가 실패하면 기존 JSON 경로를 호출하지 않고 무응답 fail-close해야 한다.
export class LegacyRankLabelSideEffectReadinessProvider {
  async resolve(database:AppWiringReadParticipant,context:PlayerContext):Promise<LegacyRankLabelSideEffectReadiness>{
    try{
      const rows=await database.query<ReadinessRow[]>(`SELECT validation.legacy_rank_label_validation_run_id,validation.object_domain_import_run_id,validation.raw_landing_run_id,
          validation.member_source_content_sha256,validation.guild_source_content_sha256,validation.rank_marker_source_fingerprint,validation.membership_semantic_sha256,validation.projection_version,validation.run_status,
          validation.expected_subject_count,validation.no_write_count,validation.would_delete_count,validation.unmapped_count,validation.validation_fingerprint,validation.legacy_runtime_source_sha256,validation.certificate_set_sha256,
          current_certificate.side_effect_decision current_decision,current_certificate.member_presence_state current_presence,current_certificate.certificate_fingerprint current_certificate_fingerprint,current_certificate.source_player_key_sha256 current_source_player_key_sha256,current_certificate.player_id current_player_id,current_certificate.guild_pointer_state current_guild_pointer_state,current_certificate.guild_pointer_fingerprint current_guild_pointer_fingerprint,current_certificate.membership_evidence_fingerprint current_membership_evidence_fingerprint,
          marker.assignment_status castle_assignment_status,marker.player_id castle_player_id,marker.source_fingerprint castle_marker_fingerprint,
          castle_certificate.side_effect_decision castle_decision,castle_certificate.certificate_fingerprint castle_certificate_fingerprint,castle_certificate.source_player_key_sha256 castle_source_player_key_sha256,castle_certificate.player_id castle_certificate_player_id,castle_certificate.member_presence_state castle_presence,castle_certificate.guild_pointer_state castle_guild_pointer_state,castle_certificate.guild_pointer_fingerprint castle_guild_pointer_fingerprint,castle_certificate.membership_evidence_fingerprint castle_membership_evidence_fingerprint,
          completeness.projection_version completeness_projection_version,completeness.revision completeness_revision,completeness.completeness_fingerprint,
          (SELECT COUNT(*) FROM data_migration_raw_files member_file WHERE member_file.raw_landing_run_id=validation.raw_landing_run_id AND member_file.source_path_sha256=validation.member_source_path_sha256 AND member_file.source_content_sha256=validation.member_source_content_sha256 AND SHA2(member_file.payload,256)=member_file.source_content_sha256) raw_member_content_match,
          (SELECT COUNT(*) FROM data_migration_raw_files guild_file WHERE guild_file.raw_landing_run_id=validation.raw_landing_run_id AND guild_file.source_path_sha256=validation.guild_source_path_sha256 AND guild_file.source_content_sha256=validation.guild_source_content_sha256 AND SHA2(guild_file.payload,256)=guild_file.source_content_sha256) raw_guild_content_match,
          (SELECT COUNT(*) FROM legacy_rank_label_side_effect_certificates aggregate_certificate WHERE aggregate_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id) actual_certificate_count,
          (SELECT COUNT(*) FROM legacy_rank_label_side_effect_certificates aggregate_certificate WHERE aggregate_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id AND aggregate_certificate.side_effect_decision='NO_WRITE') actual_no_write_count,
          (SELECT COUNT(*) FROM legacy_rank_label_side_effect_certificates aggregate_certificate WHERE aggregate_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id AND aggregate_certificate.side_effect_decision='WOULD_DELETE') actual_would_delete_count,
          (SELECT COUNT(*) FROM legacy_rank_label_side_effect_certificates aggregate_certificate WHERE aggregate_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id AND aggregate_certificate.side_effect_decision='UNMAPPED') actual_unmapped_count,
          (SELECT SHA2(GROUP_CONCAT(aggregate_certificate.certificate_fingerprint ORDER BY aggregate_certificate.certificate_fingerprint SEPARATOR '\n'),256) FROM legacy_rank_label_side_effect_certificates aggregate_certificate WHERE aggregate_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id) actual_certificate_set_sha256
          ,(SELECT GROUP_CONCAT(CONCAT_WS('|',aggregate_certificate.source_player_key_sha256,COALESCE(aggregate_certificate.player_id,''),aggregate_certificate.member_presence_state,aggregate_certificate.guild_pointer_state,aggregate_certificate.side_effect_decision,aggregate_certificate.guild_pointer_fingerprint,aggregate_certificate.membership_evidence_fingerprint,aggregate_certificate.certificate_fingerprint,
              (SELECT COUNT(DISTINCT binding_receipt.target_pk_value) FROM data_migration_object_domain_import_records binding_receipt JOIN data_migration_catalog_projection_records binding_projection ON binding_projection.catalog_projection_record_id=binding_receipt.catalog_projection_record_id JOIN data_migration_catalog_source_decisions binding_decision ON binding_decision.catalog_source_decision_id=binding_projection.catalog_source_decision_id JOIN data_migration_common_staging_records binding_staging ON binding_staging.common_staging_record_id=binding_decision.common_staging_record_id WHERE binding_receipt.object_domain_import_run_id=validation.object_domain_import_run_id AND binding_receipt.target_table_name='canonical_players' AND binding_receipt.target_pk_column_name='player_id' AND binding_staging.owner_locator_sha256=aggregate_certificate.source_player_key_sha256),
              (SELECT COUNT(*) FROM data_migration_object_domain_import_records binding_receipt JOIN data_migration_catalog_projection_records binding_projection ON binding_projection.catalog_projection_record_id=binding_receipt.catalog_projection_record_id JOIN data_migration_catalog_source_decisions binding_decision ON binding_decision.catalog_source_decision_id=binding_projection.catalog_source_decision_id JOIN data_migration_common_staging_records binding_staging ON binding_staging.common_staging_record_id=binding_decision.common_staging_record_id WHERE binding_receipt.object_domain_import_run_id=validation.object_domain_import_run_id AND binding_receipt.target_table_name='canonical_players' AND binding_receipt.target_pk_column_name='player_id' AND binding_receipt.target_pk_value=aggregate_certificate.player_id AND binding_staging.owner_locator_sha256=aggregate_certificate.source_player_key_sha256)) ORDER BY aggregate_certificate.source_player_key_sha256 SEPARATOR '\n') FROM legacy_rank_label_side_effect_certificates aggregate_certificate WHERE aggregate_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id) all_certificate_rows
        FROM legacy_rank_label_validation_runs validation
        JOIN data_migration_raw_runs raw_run ON raw_run.raw_landing_run_id=validation.raw_landing_run_id AND raw_run.run_status='COMPLETE'
        JOIN data_migration_object_domain_import_runs import_run ON import_run.object_domain_import_run_id=validation.object_domain_import_run_id AND import_run.run_status='COMPLETE'
        JOIN data_migration_catalog_projection_runs catalog ON catalog.catalog_projection_run_id=import_run.catalog_projection_run_id AND catalog.run_status='COMPLETE'
        JOIN data_migration_common_staging_runs staging ON staging.common_staging_run_id=catalog.common_staging_run_id AND staging.run_status='COMPLETE' AND staging.raw_bundle_sha256=raw_run.bundle_sha256 AND staging.snapshot_manifest_sha256=raw_run.snapshot_manifest_sha256
        JOIN player_item_bag_import_completeness_projections completeness ON completeness.object_domain_import_run_id=validation.object_domain_import_run_id AND completeness.player_id=? AND completeness.active_flag=TRUE
        JOIN player_pet_skill_rank_marker_projections marker ON marker.marker_kind='CASTLE_LORD' AND marker.active_flag=TRUE AND marker.source_fingerprint=validation.rank_marker_source_fingerprint
        LEFT JOIN legacy_rank_label_side_effect_certificates current_certificate ON current_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id AND current_certificate.player_id=?
        LEFT JOIN legacy_rank_label_side_effect_certificates castle_certificate ON castle_certificate.legacy_rank_label_validation_run_id=validation.legacy_rank_label_validation_run_id AND castle_certificate.player_id=marker.player_id
        WHERE validation.active_flag=TRUE AND validation.run_status='COMPLETE' AND validation.projection_version='LEGACY_RANK_LABEL_SIDE_EFFECT_V1'`,[context.canonicalPlayerId,context.canonicalPlayerId]);
      if(rows.length!==1)return{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"};
      const row=rows[0]!,certificates=parseCertificates(row.all_certificate_rows);
      const allCertificatesValid=certificates.length===Number(integer(row.expected_subject_count))&&certificates.every(certificate=>hash(certificate.sourcePlayerKeySha256)&&hash(certificate.guildPointerFingerprint)&&hash(certificate.membershipEvidenceFingerprint)&&hash(certificate.certificateFingerprint)&&certificate.playerId!==null&&certificate.identityPlayerCount===1n&&certificate.identityMatchCount===1n&&calculateLegacyRankLabelCertificateFingerprint(certificate)===certificate.certificateFingerprint);
      const actualCounts={noWrite:certificates.filter(certificate=>certificate.sideEffectDecision==="NO_WRITE").length,wouldDelete:certificates.filter(certificate=>certificate.sideEffectDecision==="WOULD_DELETE").length,unmapped:certificates.filter(certificate=>certificate.sideEffectDecision==="UNMAPPED").length};
      const calculatedSet=calculateLegacyRankLabelCertificateSetSha256(certificates),calculatedMembership=calculateLegacyRankLabelMembershipSemanticSha256(certificates);
      const current=certificates.find(certificate=>certificate.playerId===context.canonicalPlayerId)??null,castle=row.castle_player_id===null?null:certificates.find(certificate=>certificate.playerId===row.castle_player_id)??null;
      const currentProjectionValid=current!==null&&row.current_player_id===current.playerId&&row.current_source_player_key_sha256===current.sourcePlayerKeySha256&&row.current_decision===current.sideEffectDecision&&row.current_presence===current.memberPresenceState&&row.current_guild_pointer_state===current.guildPointerState&&row.current_guild_pointer_fingerprint===current.guildPointerFingerprint&&row.current_membership_evidence_fingerprint===current.membershipEvidenceFingerprint&&row.current_certificate_fingerprint===current.certificateFingerprint;
      const castleProjectionValid=castle===null?(row.castle_decision===null&&row.castle_certificate_fingerprint===null):(row.castle_certificate_player_id===castle.playerId&&row.castle_source_player_key_sha256===castle.sourcePlayerKeySha256&&row.castle_decision===castle.sideEffectDecision&&row.castle_presence===castle.memberPresenceState&&row.castle_guild_pointer_state===castle.guildPointerState&&row.castle_guild_pointer_fingerprint===castle.guildPointerFingerprint&&row.castle_membership_evidence_fingerprint===castle.membershipEvidenceFingerprint&&row.castle_certificate_fingerprint===castle.certificateFingerprint);
      const castleValid=row.castle_assignment_status==="UNASSIGNED"?(row.castle_player_id===null&&castle===null&&castleProjectionValid):(row.castle_assignment_status==="ASSIGNED"&&castle!==null&&castle.sideEffectDecision==="NO_WRITE"&&castle.memberPresenceState==="PRESENT"&&castleProjectionValid);
      const calculatedValidation=calculateLegacyRankLabelValidationFingerprint({rawLandingRunId:row.raw_landing_run_id,objectDomainImportRunId:row.object_domain_import_run_id,memberSourceContentSha256:row.member_source_content_sha256,guildSourceContentSha256:row.guild_source_content_sha256,rankMarkerSourceFingerprint:row.rank_marker_source_fingerprint,legacyRuntimeSourceSha256:row.legacy_runtime_source_sha256,membershipSemanticSha256:row.membership_semantic_sha256,certificateSetSha256:row.certificate_set_sha256,counts:actualCounts,status:row.run_status,projectionVersion:row.projection_version});
      const ready=integer(row.expected_subject_count)===integer(row.no_write_count)&&integer(row.would_delete_count)===0n&&integer(row.unmapped_count)===0n
        &&allCertificatesValid&&actualCounts.noWrite===Number(integer(row.no_write_count))&&actualCounts.wouldDelete===Number(integer(row.would_delete_count))&&actualCounts.unmapped===Number(integer(row.unmapped_count))&&integer(row.actual_certificate_count)===integer(row.expected_subject_count)&&integer(row.actual_no_write_count)===integer(row.no_write_count)&&integer(row.actual_would_delete_count)===integer(row.would_delete_count)&&integer(row.actual_unmapped_count)===integer(row.unmapped_count)&&hash(row.certificate_set_sha256)&&calculatedSet===row.certificate_set_sha256&&row.actual_certificate_set_sha256===row.certificate_set_sha256&&calculatedMembership===row.membership_semantic_sha256
        &&row.legacy_runtime_source_sha256===LEGACY_RANK_LABEL_RUNTIME_SOURCE_SHA256&&currentProjectionValid&&current.sideEffectDecision==="NO_WRITE"&&current.memberPresenceState==="PRESENT"&&hash(row.validation_fingerprint)&&calculatedValidation===row.validation_fingerprint
        &&hash(row.castle_marker_fingerprint)&&castleValid&&row.completeness_projection_version==="OBJECT_DOMAIN_IMPORT_RELEVANT_V3"&&integer(row.completeness_revision)>=1n&&hash(row.completeness_fingerprint)
        &&integer(row.raw_member_content_match)===1n&&integer(row.raw_guild_content_match)===1n;
      return ready?{ready:true,reasonCode:"READY",validationRunId:row.legacy_rank_label_validation_run_id}:{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"};
    }catch{return{ready:false,reasonCode:"LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"};}
  }
}
