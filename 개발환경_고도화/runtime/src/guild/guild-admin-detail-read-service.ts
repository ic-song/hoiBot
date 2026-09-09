import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

export type GuildAdminDetailCommand={kind:"usage"}|{kind:"read";guildName:string};
interface Actor{identity_id:bigint;}
interface GuildRow{guild_id:bigint;guild_name:string;guild_code:string;guild_version:bigint;level_value:bigint|null;experience:bigint|null;territory_booster:bigint|null;join_condition_experience:bigint|null;recruitment_closed:number|null;}
interface MemberRow{player_id:bigint;display_name:string;role_code:string;pet_name:string|null;}
interface ResourceRow{currency_code:string;balance:string;}
interface WarehouseRow{item_code:string;display_name:string;quantity:bigint;}
export interface GuildAdminDetailResult{status:"detail"|"usage"|"not_found";data:string;outboxId:string;guildId:string|null;memberCount:number;resourceCount:number;warehouseCount:number;}

// broad prefix와 공백 포함 길드명 trim 동작을 보존합니다.
export function parseGuildAdminDetailCommand(message:string|undefined):GuildAdminDetailCommand|null{
  if(message===undefined||!message.startsWith("/길드상세정보"))return null;
  const guildName=message.substring("/길드상세정보".length).trim();
  return guildName===""?{kind:"usage"}:{kind:"read",guildName};
}

// broad 후보를 registry 대표 별칭으로 정규화합니다.
export function normalizeGuildAdminDetailDispatchMessage(message:string):string{return parseGuildAdminDetailCommand(message)===null?message:"/길드상세정보";}

// 안정된 회원·자원 순서를 한 개의 운영자 상세 응답으로 투영합니다.
export function formatGuildAdminDetail(input:{guild:GuildRow;members:readonly MemberRow[];resources:readonly ResourceRow[];warehouse:readonly WarehouseRow[]}):string{
  const leader=input.members.find(row=>row.role_code==="master"||row.role_code==="leader");
  const subMasters=input.members.filter(row=>row.role_code==="sub_master"||row.role_code==="submaster").map(row=>row.display_name);
  const memberLines=input.members.length===0?"없음":input.members.map((row,index)=>`${index+1}. ${row.display_name} [${row.role_code}]${row.pet_name===null?"":` · 펫 ${row.pet_name}`}`).join("\n");
  const resourceLines=input.resources.length===0?"없음":input.resources.map(row=>`${row.currency_code}: ${row.balance}`).join("\n");
  const warehouseLines=input.warehouse.length===0?"없음":input.warehouse.map(row=>`${row.display_name}(${row.item_code}) x${row.quantity}`).join("\n");
  return `🏰 길드 상세정보
길드: ${input.guild.guild_name} (${input.guild.guild_code})
길드 ID: ${input.guild.guild_id}
마스터: ${leader?.display_name??"미지정"}
부마스터: ${subMasters.length===0?"없음":subMasters.join(", ")}
레벨/경험치: ${input.guild.level_value??1n} / ${input.guild.experience??0n}
영지 부스터: ${input.guild.territory_booster??0n}
가입 경험치 조건: ${input.guild.join_condition_experience??0n}
신규 가입: ${input.guild.recruitment_closed===1?"마감":"가능"}
회원 수: ${input.members.length}

[회원]
${memberLines}

[길드 자원]
${resourceLines}

[길드 창고]
${warehouseLines}`;
}

function key(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function stored(value:string|GuildAdminDetailResult):GuildAdminDetailResult{return typeof value==="string"?JSON.parse(value) as GuildAdminDetailResult:value;}

// 총괄 운영자에게 길드·회원·펫·자원·창고의 일관된 읽기 snapshot을 제공합니다.
export class GuildAdminDetailReadService{
  constructor(private readonly database:DatabaseClient){}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<GuildAdminDetailResult|null>{
    const command=parseGuildAdminDetailCommand(input.message);if(command===null)return null;
    const actors=await this.database.query<Actor[]>(`SELECT identity.id identity_id FROM external_identities identity JOIN admin_operator_external_identities link ON link.external_identity_id=identity.id JOIN admin_operators operator_row ON operator_row.id=link.operator_id AND operator_row.status='active' JOIN admin_operator_roles assignment ON assignment.operator_id=operator_row.id JOIN admin_roles role ON role.id=assignment.role_id AND role.code='super_admin' AND role.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,[input.externalUserId]),actor=actors[0];if(actor===undefined)return null;
    return this.database.withTransaction(async transaction=>{
      const eventKey=key(input.eventId),prior=await transaction.query<Array<{result_json:string|GuildAdminDetailResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='guild.admin_detail.read' AND idempotency_key=? FOR UPDATE",[eventKey]);if(prior[0]?.result_json!=null)return stored(prior[0].result_json);
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'guild.admin_detail.read',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),eventKey,actor.identity_id]);
      let status:GuildAdminDetailResult["status"],data:string,guildId:string|null=null,memberCount=0,resourceCount=0,warehouseCount=0;
      if(command.kind==="usage"){status="usage";data="사용법: /길드상세정보 [길드명]";}
      else{
        const guild=(await transaction.query<GuildRow[]>(`SELECT guild.id guild_id,guild.display_name guild_name,guild.code guild_code,guild.version guild_version,detail.level_value,detail.experience,detail.territory_booster,detail.join_condition_experience,detail.recruitment_closed FROM guilds guild LEFT JOIN guild_profile_details detail ON detail.guild_id=guild.id WHERE guild.display_name=? AND guild.status='active' ORDER BY guild.id LIMIT 1 FOR UPDATE`,[command.guildName]))[0];
        if(guild===undefined){status="not_found";data="해당 길드를 찾을 수 없습니다.";}
        else{
          const members=await transaction.query<MemberRow[]>(`SELECT member.player_id,profile.current_display_name display_name,member.role_code,pet.display_name pet_name FROM guild_members member JOIN player_profiles profile ON profile.player_id=member.player_id LEFT JOIN player_pets pet ON pet.player_id=member.player_id WHERE member.guild_id=? ORDER BY COALESCE(member.joined_at,'9999-12-31'),member.player_id`,[guild.guild_id]);
          const resources=await transaction.query<ResourceRow[]>("SELECT currency_code,balance FROM guild_resource_accounts WHERE guild_id=? ORDER BY currency_code",[guild.guild_id]);
          const warehouse=await transaction.query<WarehouseRow[]>(`SELECT item.code item_code,item.display_name,stack.quantity FROM guild_warehouse_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.guild_id=? AND stack.quantity>0 ORDER BY item.display_name,item.id`,[guild.guild_id]);
          status="detail";data=formatGuildAdminDetail({guild,members,resources,warehouse});guildId=guild.guild_id.toString();memberCount=members.length;resourceCount=resources.length;warehouseCount=warehouse.length;
        }
      }
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,input.destinationId,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'GUILD_ADMIN_DETAIL_READ',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation.insertId,status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'guild',?,'guild.admin_detail.read',?,'Iris /길드상세정보',?,UTC_TIMESTAMP(3))",[operation.insertId,actor.identity_id,guildId,status,JSON.stringify({memberCount,resourceCount,warehouseCount,domainMutation:false})]);
      const result:GuildAdminDetailResult={status,data,outboxId:outbox.insertId.toString(),guildId,memberCount,resourceCount,warehouseCount};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}
