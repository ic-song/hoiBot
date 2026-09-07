import { hasDatabaseTransactionCapabilities, type DatabaseClient } from "../database.js";
import { MariaCanonicalPetSkillReadProvider, type CanonicalPetSkillReadDefinition } from "./canonical-pet-skill-read-provider.js";
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
  public async evaluate(input:{externalUserId:string;displayName:string|undefined;message:string}):Promise<{status:"shadow";reply:string}|{status:"legacy_fallback";reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"}|null>{
    const command=parsePetSkillInfoShadowCommand(input.message);
    if(command===undefined||input.displayName===undefined||(input.displayName.length>4&&input.displayName!=="오픈채팅봇"))return null;
    if(!hasDatabaseTransactionCapabilities(this.database))throw new Error("PET_SKILL_INFO_SNAPSHOT_CAPABILITY_REQUIRED");
    return this.database.withReadOnlySnapshot(async transaction=>{
      const actors=await transaction.query<Array<{player_status:string;is_operator:number}>>(`SELECT player.status player_status,EXISTS(SELECT 1 FROM admin_operator_external_identities mapping JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE AND role.code IN ('manager','super_admin') WHERE mapping.external_identity_id=identity.id) is_operator FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.deleted_at IS NULL WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.id LIMIT 2`,[input.externalUserId]);
      if(actors.length>1)throw new Error("PET_SKILL_INFO_IDENTITY_DUPLICATE");
      if(actors.length===0||actors[0]!.player_status!=="active")return null;
      if(command.query===null)return{status:"shadow",reply:"사용법:\n/펫스킬정보 [펫스킬이름] — 펫스킬 효과 조회\n/펫스킬정보 [유저닉네임] — 유저 펫스킬가방 조회 (관리자 전용)"};
      const targets=await transaction.query<Array<{player_id:bigint}>>("SELECT profile.player_id FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.deleted_at IS NULL WHERE profile.current_display_name=? ORDER BY profile.player_id LIMIT 2",[command.query]);
      if(targets.length>1)throw new Error("PET_SKILL_INFO_PLAYER_NAME_AMBIGUOUS");
      if(targets.length===1&&Number(actors[0]!.is_operator)===1)return{status:"legacy_fallback",reason:"ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN"};
      const catalog=await new MariaCanonicalPetSkillReadProvider(this.database).readCatalogInSnapshot(transaction);
      const charmRows=await transaction.query<Array<{pet_skill_id:string;raid_charm_bonus:string|null;castle_charm_bonus:string|null}>>("SELECT pet_skill_id,CAST(raid_charm_bonus AS CHAR) raid_charm_bonus,CAST(castle_charm_bonus AS CHAR) castle_charm_bonus FROM canonical_pet_skill_definitions WHERE active_flag=TRUE ORDER BY display_order,pet_skill_id");
      if(charmRows.length!==catalog.definitions.length)throw new Error("PET_SKILL_INFO_CHARM_SET_DRIFT");
      const charmById=new Map<string,{raid:number;castle:number}>();for(const row of charmRows){if(row.raid_charm_bonus===null||row.castle_charm_bonus===null)throw new Error("PET_SKILL_INFO_CHARM_METADATA_INVALID");const raid=Number(row.raid_charm_bonus),castle=Number(row.castle_charm_bonus);if(charmById.has(row.pet_skill_id)||!Number.isSafeInteger(raid)||raid<0||!Number.isSafeInteger(castle)||castle<0)throw new Error("PET_SKILL_INFO_CHARM_METADATA_INVALID");charmById.set(row.pet_skill_id,{raid,castle});}
      const definitions=catalog.definitions.map(row=>{const charm=charmById.get(row.petSkillId);if(charm===undefined)throw new Error("PET_SKILL_INFO_CHARM_SET_DRIFT");return{...row,raidCharmBonus:charm.raid,castleCharmBonus:charm.castle};});
      const found=resolveLegacyPetSkillInfo(definitions,command.query);
      return{status:"shadow",reply:found===undefined?(targets.length===1?"❌ 다른 유저의 펫스킬 조회는 관리자만 가능합니다.":"등록되지 않은 펫스킬입니다.\n또는 존재하지 않는 유저입니다."):formatLegacyPetSkillInfo(found)};
    });
  }
}
