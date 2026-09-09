import { createHash } from "node:crypto";

export interface LegacyRankLabelCertificateFields {
  readonly sourcePlayerKeySha256:string;
  readonly playerId:string|null;
  readonly memberPresenceState:string;
  readonly guildPointerState:string;
  readonly sideEffectDecision:string;
  readonly guildPointerFingerprint:string;
  readonly membershipEvidenceFingerprint:string;
}

export interface LegacyRankLabelValidationFields {
  readonly rawLandingRunId:string;
  readonly commonStagingRunId:string;
  readonly objectDomainImportRunId:string;
  readonly memberSourcePathSha256:string;
  readonly memberSourceContentSha256:string;
  readonly guildSourcePathSha256:string;
  readonly guildSourceContentSha256:string;
  readonly rankMarkerSourceFingerprint:string;
  readonly legacyRuntimeSourceSha256:string;
  readonly membershipSemanticSha256:string;
  readonly certificateSetSha256:string;
  readonly counts:{readonly noWrite:number;readonly wouldDelete:number;readonly unmapped:number};
  readonly status:string;
  readonly projectionVersion:string;
}

export const canonicalLegacyRankLabel=(value:unknown):string=>{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalLegacyRankLabel).join(",")}]`;
  const record=value as Record<string,unknown>;
  return `{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonicalLegacyRankLabel(record[key])}`).join(",")}}`;
};
export const legacyRankLabelSha256=(value:string|Buffer):string=>createHash("sha256").update(value).digest("hex");
export const calculateLegacyRankLabelCertificateFingerprint=(row:LegacyRankLabelCertificateFields):string=>legacyRankLabelSha256(canonicalLegacyRankLabel({sourcePlayerKeySha256:row.sourcePlayerKeySha256,playerId:row.playerId,memberPresenceState:row.memberPresenceState,guildPointerState:row.guildPointerState,sideEffectDecision:row.sideEffectDecision,guildPointerFingerprint:row.guildPointerFingerprint,membershipEvidenceFingerprint:row.membershipEvidenceFingerprint}));
export const calculateLegacyRankLabelCertificateSetSha256=(rows:readonly (LegacyRankLabelCertificateFields&{readonly certificateFingerprint:string})[]):string=>legacyRankLabelSha256(rows.map(row=>row.certificateFingerprint).sort().join("\n"));
export const calculateLegacyRankLabelMembershipSemanticSha256=(rows:readonly LegacyRankLabelCertificateFields[]):string=>legacyRankLabelSha256(canonicalLegacyRankLabel([...rows].sort((left,right)=>left.sourcePlayerKeySha256.localeCompare(right.sourcePlayerKeySha256)).map(row=>({source:row.sourcePlayerKeySha256,state:row.guildPointerState,decision:row.sideEffectDecision}))));
export const calculateLegacyRankLabelValidationFingerprint=(value:LegacyRankLabelValidationFields):string=>legacyRankLabelSha256(canonicalLegacyRankLabel(value));
