import { createHash } from "node:crypto";
import { hasDatabaseTransactionCapabilities, type DatabaseClient, type ReadOnlySnapshotTransaction } from "../database.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";
import { MariaCanonicalPetSkillReadProvider, type CanonicalPetSkillReadDefinition } from "./canonical-pet-skill-read-provider.js";
import type { PetSkillInfoActorContext } from "./pet-skill-info-actor-context-provider.js";
type PetSkillInfoDefinition=CanonicalPetSkillReadDefinition&{raidCharmBonus:number;castleCharmBonus:number};

export interface PetSkillInfoCommand { readonly query: string | null; }

export function parsePetSkillInfoShadowCommand(message: string | undefined): PetSkillInfoCommand | undefined {
  if (message === "/펫스킬정보") return { query: null };
  if(message===undefined||!message.startsWith("/펫스킬정보"))return undefined;
  const query=message.replace("/펫스킬정보","").trim();
  return { query: query === "" ? null : query };
}

export function isPetSkillInfoShadowCandidate(message: string | undefined): boolean {
  return parsePetSkillInfoShadowCommand(message) !== undefined;
}

export function normalizePetSkillInfoDispatchMessage(message: string): string {
  const command = parsePetSkillInfoShadowCommand(message);
  if (command === undefined) throw new Error("PET_SKILL_INFO_COMMAND_INVALID");
  return command.query === null ? "/펫스킬정보" : "/펫스킬정보 [조회값]";
}

const LEGACY_NAMES: Readonly<Record<string,string>> = {
  "하느님위에갓물주":"하느님 위에 갓물주","야수의본능":"야수의 본능","종의본능":"종의 본능",
  "펫스킬학개론":"펫스킬 학개론","호이행복재단회원권":"호이행복재단 회원권","로열하우스":"로열 하우스",
  "길드의심장":"길드의 심장","전투형지휘관":"전투형 지휘관","기사단증원":"기사단 증원",
  "타고난장사꾼":"타고난 장사꾼","티어상승론":"티어 상승론","망한건맞아":"망한건 맞아",
  "광산 탐험가":"광산탐험가","던전 탐험가":"던전탐험가"
};
export function normalizeLegacyPetSkillInfoName(value:string):string {
  const stripped=String(value||"").replace(/^\[펫스킬북\]/,"").replace(/📙/g,"").replace(/✨/g,"").trim();
  return LEGACY_NAMES[stripped]??stripped;
}
function tierSearchName(definition:PetSkillInfoDefinition):string {
  if(!definition.tierExclusive)return "";
  const normalized=normalizeLegacyPetSkillInfoName(definition.name),space=normalized.indexOf(" ");
  return space===-1?normalized:normalized.slice(space+1).trim();
}
function commas(value:number):string{return String(value).replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function commasBigInt(value:bigint):string{return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");}
const ALLSEE="\u200b".repeat(500);
const BAG_GUIDE="━━━━━━━━━━━━━\n※ 스킬 장착: /펫스킬장착 [번호]\n※ 스킬 판매: /펫스킬판매 [번호]\n※ 스킬 분해: /펫스킬북분해 [번호] [개수]\n※ 스킬 정보: /펫스킬정보 [스킬이름]\n━━━━━━━━━━━━━\n";
const MARKERS=Object.freeze([
  ["CASTLE_LORD",1,"🏰"],["STAR",2,"💞"],["CARROT",3,"🥕"],["THERMO",4,"🌡"],
  ["MINI_PET",5,"✨"],["TOP_LEVEL",6,"🌟"],["MC",7,"💬"],["INTIMACY",8,"🍼"]
] as const);
const GUILD_RANK_SYMBOLS=Object.freeze(["☬","♔","♛","♕","⚝","❁","⌺","⍌","⍫","⚔︎","⚚","✥","❖","◈","◉","◍","◌","△","◇","◻︎"]);
type BagStackFingerprintRow={owned_pet_skill_id:string;pet_skill_id:string;legacy_source_key:string;pet_skill_name:string;pet_skill_grade:string|null;display_order:number|null;quantity:bigint};

function stableJson(value:unknown):string{
  if(typeof value==="bigint")return JSON.stringify(value.toString());
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stableJson).join(",")}]`;
  const record=value as Record<string,unknown>;
  return `{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}
function fingerprint(value:unknown):string{return createHash("sha256").update(stableJson(value),"utf8").digest("hex");}
export function fingerprintPetSkillInfoCatalog(definitions:readonly CanonicalPetSkillReadDefinition[]):string{return fingerprint(definitions.map(row=>[row.petSkillId,row.name,row.description,row.grade,row.gradeEmoji,row.legacySourceKey,row.displayOrder,row.baseDrawRate,row.actualRate,row.fixedDrawRate,row.openable,row.requiredTierName,row.tierExclusive,row.equipDescription,row.handlerKey,row.options,row.aliases]));}
export function fingerprintPetSkillInfoBagStacks(rows:readonly BagStackFingerprintRow[]):string{return fingerprint(rows.map(row=>[row.owned_pet_skill_id,row.pet_skill_id,row.legacy_source_key,row.pet_skill_name,row.pet_skill_grade,row.display_order,String(row.quantity)]));}

export interface PetSkillAdminBagProjection {readonly status:"shadow";readonly reply:string;readonly projectionVersion:"PET_SKILL_ADMIN_BAG_V1";readonly targetPlayerId:string;readonly total:string;readonly visibleCount:number;readonly premium:boolean;readonly rankDisplay:string}
type ShadowResult={status:"shadow";reply:string}|{status:"legacy_fallback";reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"}|null;
type PetSkillInfoEvaluationInput={externalUserId:string;externalChannelId?:string;displayName:string|undefined;message:string;actorContext?:PetSkillInfoActorContext};

export function formatLegacyPetSkillAdminBag(input:{displayName:string;rankDisplay:string;premium:boolean;total:bigint;skills:readonly {name:string;grade:string;quantity:bigint}[]}):string{
  let message=`${input.premium?"[👑호이패스 프리미엄👑]\n":""}[${input.rankDisplay}] 보유 스킬가방📙[${commasBigInt(input.total)}/100]\n${BAG_GUIDE}`;
  if(input.skills.length===0)return message+"보유 중인 펫스킬북이 없습니다.";
  message+=ALLSEE+"\n";
  for(let index=0;index<input.skills.length;index+=1){const skill=input.skills[index]!;message+=`${index+1}. ${normalizeLegacyPetSkillInfoName(skill.name)}📙[${skill.grade}] x${commasBigInt(skill.quantity)}\n`;}
  return message.trim();
}

export function resolveLegacyPetSkillInfo(definitions:readonly PetSkillInfoDefinition[],query:string):PetSkillInfoDefinition|undefined {
  const normalized=normalizeLegacyPetSkillInfoName(query);
  const matches=definitions.filter(definition=>normalizeLegacyPetSkillInfoName(definition.name)===normalized
    || tierSearchName(definition)===normalized
    || definition.aliases.some(alias=>normalizeLegacyPetSkillInfoName(alias)===normalized));
  if(matches.length>1)throw new Error("PET_SKILL_INFO_LOOKUP_AMBIGUOUS");
  return matches[0];
}

export function formatLegacyPetSkillInfo(definition:PetSkillInfoDefinition):string {
  const tier=definition.tierExclusive
    ? `\n종합매력 ${commas((definition.raidCharmBonus+definition.castleCharmBonus)/10000)}만 증가\n티어전용 펫스킬 중복 장착은 불가합니다.\n일반 종합매력 무기 펫스킬과는 중복 장착할 수 있습니다.`:"";
  return `${normalizeLegacyPetSkillInfoName(definition.name)}📙\n등급: ${definition.grade}\n확률: ${definition.actualRate.toFixed(1)}%\n효과: ${definition.description}${tier}`;
}

export class PetSkillInfoShadowService {
  public constructor(private readonly database:DatabaseClient){}
  public async evaluate(input:PetSkillInfoEvaluationInput):Promise<ShadowResult>{
    const command=parsePetSkillInfoShadowCommand(input.message);
    if(command===undefined||input.displayName===undefined||(input.displayName.length>4&&input.displayName!=="오픈채팅봇"))return null;
    if(!hasDatabaseTransactionCapabilities(this.database))throw new Error("PET_SKILL_INFO_SNAPSHOT_CAPABILITY_REQUIRED");
    return this.database.withReadOnlySnapshot(transaction=>this.evaluateInSnapshot(transaction,input));
  }
  public async evaluateInSnapshot(transaction:ReadOnlySnapshotTransaction|AppWiringReadParticipant,input:PetSkillInfoEvaluationInput):Promise<ShadowResult>{
      const command=parsePetSkillInfoShadowCommand(input.message);
      if(command===undefined||input.displayName===undefined||(input.displayName.length>4&&input.displayName!=="오픈채팅봇"))return null;
      const actorIdentityId=input.actorContext?.externalIdentityId;
      let resolvedActorIdentityId:bigint;
      if(actorIdentityId===undefined){
        const actors=await transaction.query<Array<{player_status:string;identity_id:bigint}>>(`SELECT player.status player_status,identity.id identity_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.deleted_at IS NULL WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.id LIMIT 2`,[input.externalUserId]);
        if(actors.length>1)throw new Error("PET_SKILL_INFO_IDENTITY_DUPLICATE");
        if(actors.length===0||actors[0]!.player_status!=="active")return null;
        resolvedActorIdentityId=actors[0]!.identity_id;
      }else{
        try{resolvedActorIdentityId=BigInt(actorIdentityId);}catch{throw new Error("PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT");}
        if(resolvedActorIdentityId<=0n)throw new Error("PET_SKILL_INFO_ACTOR_CONTEXT_DRIFT");
      }
      if(command.query===null)return{status:"shadow",reply:"사용법:\n/펫스킬정보 [펫스킬이름] — 펫스킬 효과 조회\n/펫스킬정보 [유저닉네임] — 유저 펫스킬가방 조회 (관리자 전용)"};
      const targets=await transaction.query<Array<{player_id:bigint}>>("SELECT profile.player_id FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.deleted_at IS NULL WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2",[command.query]);
      if(targets.length>1)throw new Error("PET_SKILL_INFO_PLAYER_NAME_AMBIGUOUS");
      const actorScopes=targets.length===1?await this.readActorScopes(transaction,resolvedActorIdentityId):[];
      if(targets.length===1&&actorScopes.length>0){
        const projection=await this.readAdminBagProjection(transaction,{actorScopes,externalChannelId:input.externalChannelId,targetPlayerId:targets[0]!.player_id,displayName:command.query});
        return projection??{status:"legacy_fallback",reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"};
      }
      const catalog=await new MariaCanonicalPetSkillReadProvider(this.database).readCatalogInSnapshot(transaction);
      const charmRows=await transaction.query<Array<{pet_skill_id:string;raid_charm_bonus:string|null;castle_charm_bonus:string|null}>>("SELECT pet_skill_id,CAST(raid_charm_bonus AS CHAR) raid_charm_bonus,CAST(castle_charm_bonus AS CHAR) castle_charm_bonus FROM canonical_pet_skill_definitions WHERE active_flag=TRUE ORDER BY display_order,pet_skill_id");
      if(charmRows.length!==catalog.definitions.length)throw new Error("PET_SKILL_INFO_CHARM_SET_DRIFT");
      const charmById=new Map<string,{raid:number;castle:number}>();for(const row of charmRows){if(row.raid_charm_bonus===null||row.castle_charm_bonus===null)throw new Error("PET_SKILL_INFO_CHARM_METADATA_INVALID");const raid=Number(row.raid_charm_bonus),castle=Number(row.castle_charm_bonus);if(charmById.has(row.pet_skill_id)||!Number.isSafeInteger(raid)||raid<0||!Number.isSafeInteger(castle)||castle<0)throw new Error("PET_SKILL_INFO_CHARM_METADATA_INVALID");charmById.set(row.pet_skill_id,{raid,castle});}
      const definitions=catalog.definitions.map(row=>{const charm=charmById.get(row.petSkillId);if(charm===undefined)throw new Error("PET_SKILL_INFO_CHARM_SET_DRIFT");return{...row,raidCharmBonus:charm.raid,castleCharmBonus:charm.castle};});
      const found=resolveLegacyPetSkillInfo(definitions,command.query);
      return{status:"shadow",reply:found===undefined?(targets.length===1?"❌ 다른 유저의 펫스킬 조회는 관리자만 가능합니다.":"등록되지 않은 펫스킬입니다.\n또는 존재하지 않는 유저입니다."):formatLegacyPetSkillInfo(found)};
  }

  private async readActorScopes(transaction:ReadOnlySnapshotTransaction|AppWiringReadParticipant,identityId:bigint):Promise<readonly ("ADMIN"|"MASTER")[]>{
    const rows=await transaction.query<Array<{operator_id:bigint;role_code:string}>>(`SELECT operator.id operator_id,role.code role_code FROM admin_operator_external_identities mapping JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE AND role.code IN ('manager','super_admin') WHERE mapping.external_identity_id=? AND NOT EXISTS(SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='pet.skill.info.admin_bag.read' AND denied.effect='deny') AND (EXISTS(SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='pet.skill.info.admin_bag.read' AND allowed.effect='allow') OR EXISTS(SELECT 1 FROM admin_operator_roles granted_role JOIN admin_role_permissions role_permission ON role_permission.role_id=granted_role.role_id AND role_permission.permission_code='pet.skill.info.admin_bag.read' WHERE granted_role.operator_id=operator.id)) ORDER BY operator.id,role.id`,[identityId]);
    if(rows.length===0)return [];
    if(new Set(rows.map(row=>String(row.operator_id))).size!==1)throw new Error("PET_SKILL_INFO_OPERATOR_CROSSWALK_DUPLICATE");
    const scopes:("ADMIN"|"MASTER")[]=[];if(rows.some(row=>row.role_code==="manager"))scopes.push("ADMIN");if(rows.some(row=>row.role_code==="super_admin"))scopes.push("MASTER");return scopes;
  }
  private async readAdminBagProjection(transaction:ReadOnlySnapshotTransaction|AppWiringReadParticipant,input:{actorScopes:readonly ("ADMIN"|"MASTER")[];externalChannelId:string|undefined;targetPlayerId:bigint;displayName:string}):Promise<PetSkillAdminBagProjection|null>{
    if(input.externalChannelId===undefined)return null;
    const authorities=await transaction.query<Array<{operator_scope:string;authority_decision:string;source_fingerprint:string;revision:bigint}>>(`SELECT authority.operator_scope,authority.authority_decision,authority.source_fingerprint,authority.revision FROM channels channel JOIN pet_skill_info_admin_channel_authorities authority ON authority.provider_code=channel.provider_code AND authority.external_channel_id=channel.external_channel_id AND authority.operator_scope IN (${input.actorScopes.map(()=>"?").join(",")}) AND authority.active_flag=TRUE WHERE channel.provider_code='kakao' AND channel.external_channel_id=? AND channel.status='active' ORDER BY authority.operator_scope,authority.authority_decision,authority.pet_skill_info_admin_channel_authority_id`,[...input.actorScopes,input.externalChannelId]);
    if(authorities.some(row=>row.authority_decision==="DENY")||authorities.length===0||authorities.some(row=>row.authority_decision!=="ALLOW"||!this.validSource(row))||new Set(authorities.map(row=>row.operator_scope)).size!==authorities.length)return null;
    const targetRows=await transaction.query<Array<{player_id:bigint;rank_emoji:string|null;canonical_player_id:string|null}>>(`SELECT player.id player_id,rank_profile.rank_emoji,canonical_player.player_id canonical_player_id FROM players player JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id LEFT JOIN canonical_players canonical_player ON canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier=CAST(player.id AS CHAR) WHERE player.id=? AND player.status='active' AND player.deleted_at IS NULL AND BINARY profile.current_display_name=BINARY ? ORDER BY canonical_player.player_id LIMIT 2`,[input.targetPlayerId,input.displayName]);
    if(targetRows.length!==1||targetRows[0]!.canonical_player_id===null||targetRows[0]!.rank_emoji===null)return null;
    const markers=await transaction.query<Array<{marker_kind:string;marker_priority:number;assignment_status:string;player_id:string|null;legacy_player_id:bigint|null;source_fingerprint:string;revision:bigint}>>(`SELECT marker.marker_kind,marker.marker_priority,marker.assignment_status,marker.player_id,CASE WHEN canonical_player.source_system='LEGACY_DB' AND canonical_player.source_identifier REGEXP '^(0|[1-9][0-9]{0,19})$' THEN CAST(canonical_player.source_identifier AS UNSIGNED) ELSE NULL END legacy_player_id,marker.source_fingerprint,marker.revision FROM player_pet_skill_rank_marker_projections marker LEFT JOIN canonical_players canonical_player ON canonical_player.player_id=marker.player_id WHERE marker.active_flag=TRUE ORDER BY marker.marker_priority,marker.player_pet_skill_rank_marker_projection_id`);
    if(markers.length!==8||markers.some((row,index)=>row.marker_kind!==MARKERS[index]![0]||Number(row.marker_priority)!==MARKERS[index]![1]||!this.validSource(row)||!((row.assignment_status==="ASSIGNED"&&row.player_id!==null&&row.legacy_player_id!==null)||(row.assignment_status==="UNASSIGNED"&&row.player_id===null&&row.legacy_player_id===null))))return null;
    const memberships=await transaction.query<Array<{player_id:bigint;guild_id:bigint;ordinal_value:number|null;snapshot_id:bigint|null;current_snapshot_id:bigint|null}>>(`SELECT member.player_id,member.guild_id,rank_projection.ordinal_value,rank_projection.snapshot_id,current_rank.snapshot_id current_snapshot_id FROM guild_members member JOIN guilds guild ON guild.id=member.guild_id AND guild.status='active' LEFT JOIN guild_rank_snapshot_current current_rank ON current_rank.policy_key='default' LEFT JOIN guild_rank_current_projections rank_projection ON rank_projection.guild_id=member.guild_id WHERE member.player_id IN (?,?) ORDER BY member.player_id`,[input.targetPlayerId,markers[0]!.legacy_player_id]);
    const targetMemberships=memberships.filter(row=>String(row.player_id)===String(input.targetPlayerId));
    const lordMemberships=markers[0]!.legacy_player_id===null?[]:memberships.filter(row=>String(row.player_id)===String(markers[0]!.legacy_player_id));
    if(targetMemberships.length>1||lordMemberships.length!==(markers[0]!.assignment_status==="ASSIGNED"?1:0))return null;
    let markerPrefix="";
    if(lordMemberships.length===1&&targetMemberships.length===1&&targetMemberships[0]!.guild_id===lordMemberships[0]!.guild_id)markerPrefix="🏰";
    else{const direct=markers.slice(1).find(row=>row.player_id===targetRows[0]!.canonical_player_id);if(direct!==undefined)markerPrefix=MARKERS[direct.marker_priority-1]![2];}
    let guildSuffix="";
    if(targetMemberships.length===1){const membership=targetMemberships[0]!;if(membership.current_snapshot_id===null||membership.snapshot_id!==membership.current_snapshot_id||membership.ordinal_value===null||membership.ordinal_value<1||membership.ordinal_value>20)return null;guildSuffix=`_${GUILD_RANK_SYMBOLS[membership.ordinal_value-1]}`;}
    const premiumRows=await transaction.query<Array<{premium_active:number}>>(`SELECT EXISTS(SELECT 1 FROM player_support_passes pass WHERE pass.player_id=? AND pass.pass_code='premium' AND pass.status='active' AND (pass.entitlement_kind='permanent' OR pass.end_date>=DATE(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 9 HOUR)))) premium_active`,[input.targetPlayerId]);
    if(premiumRows.length!==1)return null;
    const completeness=await transaction.query<Array<{expected_source_key_count:number;projected_stack_count:number;quarantined_source_key_count:number;ignored_source_key_count:number;source_fingerprint:string;catalog_projection_sha256:string;catalog_set_fingerprint:string;stack_set_fingerprint:string;revision:bigint;run_status:string;import_sha256:string;run_catalog_projection_sha256:string;expected_source_count:number;projected_source_count:number;run_quarantined_source_count:number;run_ignored_source_count:number;expected_row_count:number;imported_row_count:number}>>(`SELECT completeness.expected_source_key_count,completeness.projected_stack_count,completeness.quarantined_source_key_count,completeness.ignored_source_key_count,completeness.source_fingerprint,completeness.catalog_projection_sha256,completeness.catalog_set_fingerprint,completeness.stack_set_fingerprint,completeness.revision,import_run.run_status,import_run.import_sha256,import_run.catalog_projection_sha256 run_catalog_projection_sha256,import_run.expected_source_count,import_run.projected_source_count,import_run.quarantined_source_count run_quarantined_source_count,import_run.ignored_source_count run_ignored_source_count,import_run.expected_row_count,import_run.imported_row_count FROM player_pet_skill_bag_import_completeness_projections completeness JOIN data_migration_object_domain_import_runs import_run ON import_run.object_domain_import_run_id=completeness.object_domain_import_run_id WHERE completeness.player_id=? AND completeness.active_flag=TRUE ORDER BY completeness.revision DESC`,[targetRows[0]!.canonical_player_id]);
    if(completeness.length!==1||!this.validSource(completeness[0]!)||completeness[0]!.run_status!=="COMPLETE"||completeness[0]!.source_fingerprint!==completeness[0]!.import_sha256||completeness[0]!.catalog_projection_sha256!==completeness[0]!.run_catalog_projection_sha256||Number(completeness[0]!.expected_source_count)!==Number(completeness[0]!.projected_source_count)+Number(completeness[0]!.run_quarantined_source_count)+Number(completeness[0]!.run_ignored_source_count)||Number(completeness[0]!.expected_row_count)!==Number(completeness[0]!.imported_row_count)||Number(completeness[0]!.expected_source_key_count)!==Number(completeness[0]!.projected_stack_count)||Number(completeness[0]!.quarantined_source_key_count)!==0||Number(completeness[0]!.ignored_source_key_count)!==0)return null;
    const catalog=await new MariaCanonicalPetSkillReadProvider(this.database).readCatalogInSnapshot(transaction);
    if(catalog.definitions.length!==93||fingerprintPetSkillInfoCatalog(catalog.definitions)!==completeness[0]!.catalog_set_fingerprint)return null;
    const stacks=await transaction.query<BagStackFingerprintRow[]>(`SELECT stack.owned_pet_skill_id,stack.pet_skill_id,definition.legacy_source_key,definition.pet_skill_name,definition.pet_skill_grade,definition.display_order,stack.quantity FROM canonical_owned_pet_skill_stacks stack JOIN canonical_pet_skill_definitions definition ON definition.pet_skill_id=stack.pet_skill_id WHERE stack.player_id=? ORDER BY stack.owned_pet_skill_id`,[targetRows[0]!.canonical_player_id]);
    const catalogById=new Map(catalog.definitions.map(row=>[row.petSkillId,row]));
    if(stacks.length!==Number(completeness[0]!.projected_stack_count)||new Set(stacks.map(row=>row.owned_pet_skill_id)).size!==stacks.length||new Set(stacks.map(row=>row.pet_skill_id)).size!==stacks.length||stacks.some(row=>{const definition=catalogById.get(row.pet_skill_id);return !/^\d+$/.test(String(row.quantity))||row.pet_skill_grade===null||row.display_order===null||definition===undefined||definition.legacySourceKey!==row.legacy_source_key||definition.name!==row.pet_skill_name||definition.grade!==row.pet_skill_grade||definition.displayOrder!==Number(row.display_order);} )||fingerprintPetSkillInfoBagStacks(stacks)!==completeness[0]!.stack_set_fingerprint)return null;
    stacks.sort((left,right)=>(left.display_order??999)-(right.display_order??999)||left.pet_skill_name.localeCompare(right.pet_skill_name,"ko")||left.owned_pet_skill_id.localeCompare(right.owned_pet_skill_id));
    const total=stacks.reduce((sum,row)=>sum+BigInt(row.quantity),0n);
    const visible=stacks.filter(row=>BigInt(row.quantity)>0n).map(row=>({name:row.pet_skill_name,grade:row.pet_skill_grade??"미확인",quantity:BigInt(row.quantity)}));
    const premium=Number(premiumRows[0]!.premium_active)===1,rankDisplay=`${markerPrefix||targetRows[0]!.rank_emoji}${input.displayName}${guildSuffix}`;
    return{status:"shadow",reply:formatLegacyPetSkillAdminBag({displayName:input.displayName,rankDisplay,premium,total,skills:visible}),projectionVersion:"PET_SKILL_ADMIN_BAG_V1",targetPlayerId:String(input.targetPlayerId),total:total.toString(),visibleCount:visible.length,premium,rankDisplay};
  }
  private validSource(row:{source_fingerprint:string;revision:bigint}):boolean{return /^[0-9a-f]{64}$/.test(row.source_fingerprint)&&BigInt(row.revision)>=1n;}
}
