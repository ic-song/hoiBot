import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

const ALL_SEE = "\u200b".repeat(500);
const PERCENT_SCALE = 100000n;
type Numeric = bigint | number | string;

interface SourceRow {
  player_id: Numeric; pet_id: Numeric; source_order: Numeric | null;
  pet_image: string | null; pet_title: string | null; pet_name: string;
  item_raid_charm: Numeric; pet_experience: Numeric; mini_pet_raid_charm: Numeric;
  home_charm: Numeric; personal_cube_percent: string | null; guild_cube_units: Numeric | null;
  pet_version: Numeric; item_version: Numeric;
  personal_cube_version: Numeric; guild_cube_version: Numeric;
}

export interface RaidCharmRankingRow {
  playerId: string; petId: string; sourceOrder: bigint | null;
  petImage: string; petTitle: string; petName: string;
  itemRaidCharm: bigint; petExperience: bigint; miniPetRaidCharm: bigint; homeCharm: bigint;
  personalCubePercent: string; guildCubeUnits: bigint; finalRaidCharm: bigint;
}

export interface RaidCharmRankingResult {
  status: "completed"; data: string; snapshotId: string; outboxId: string;
  rowCount: number; sourceVersion: string; replayed: boolean;
}

export interface RaidCharmScoreInput {
  itemRaidCharm: bigint; petExperience: bigint; miniPetRaidCharm: bigint; homeCharm: bigint;
  personalCubePercent: string; guildCubeUnits: bigint;
}

// 인자가 없는 정확한 레이드 매력 순위 명령만 현대화 경로로 전달합니다.
export function isRaidCharmRankingReadCommand(message: string | undefined): boolean {
  return message === "/레이드매력순위";
}

// 레거시 구성요소 합계에 개인·길드 큐브 비율을 정수 내림으로 적용합니다.
export function calculateRaidCharmScore(input: RaidCharmScoreInput): bigint {
  const base = input.itemRaidCharm + input.petExperience + input.miniPetRaidCharm + input.homeCharm;
  const guildUnits = input.guildCubeUnits < 0n ? 0n : input.guildCubeUnits > 500n ? 500n : input.guildCubeUnits;
  return base * (PERCENT_SCALE + parsePercentMilli(input.personalCubePercent) + guildUnits * 100n) / PERCENT_SCALE;
}

// 순위·표시·allsee 경계를 immutable snapshot 순서 그대로 렌더링합니다.
export function formatRaidCharmRanking(rows: readonly RaidCharmRankingRow[]): string {
  const title = "🏆 [레이드]매력 순위 🏆";
  if (rows.length === 0) return `${title}\n\n순위 대상이 없습니다.`;
  const lines = rows.map((row,index) => `${rankPrefix(index+1)}${row.petImage}${row.petTitle} ${row.petName} 👾 ${commas(row.finalRaidCharm)}\n`);
  return `${title}\n\n${lines.slice(0,10).join("")}${ALL_SEE}${lines.slice(10).join("")}`;
}

// 활성 회원의 레이드 매력 구성요소를 한 snapshot으로 읽고 감사·outbox를 원자 기록합니다.
export class RaidCharmRankingReadService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input:{eventId:string;externalUserId:string;channelId:string;message:string}):Promise<RaidCharmRankingResult|null>{
    if (!isRaidCharmRankingReadCommand(input.message)) return null;
    return this.database.withTransaction(async transaction=>{
      const key=eventKey(input.eventId),scope="raid.charm_ranking.read";
      const reservation=await transaction.execute(
        "INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'external_identity',NULL,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key]
      );
      if(reservation.affectedRows===0n){
        const prior=(await transaction.query<Array<{result_json:string|RaidCharmRankingResult|null}>>(
          "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]
        ))[0];
        if(prior?.result_json!=null)return{...stored(prior.result_json),replayed:true};
        throw new Error("레이드 매력 순위 operation 결과를 확인할 수 없습니다.");
      }
      const operation=reservation.insertId;
      const source=await transaction.query<SourceRow[]>(
        `SELECT player.id player_id,pet.id pet_id,rank_profile.source_order,
                pet.image_value pet_image,
                COALESCE((SELECT title.display_name FROM pet_titles assignment JOIN title_definitions title ON title.id=assignment.title_id WHERE assignment.player_pet_id=pet.id AND assignment.equipped=TRUE ORDER BY assignment.acquired_at,title.id LIMIT 1),'') pet_title,
                pet.display_name pet_name,
                COALESCE((SELECT SUM(CAST(stack.quantity AS DECIMAL(65,0))*rule.raid_charm)
                            FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id AND item.active=TRUE
                            JOIN player_overall_charm_skill_rules rule ON rule.display_name=item.display_name AND rule.active=TRUE
                              AND rule.condition_code IS NULL AND rule.home_charm_percent=0
                           WHERE stack.player_id=player.id),0) item_raid_charm,
                pet.experience pet_experience,COALESCE(mini.raid_experience,0) mini_pet_raid_charm,
                COALESCE(home.base_experience,0)+COALESCE((SELECT SUM(instance.charm_snapshot) FROM furniture_inventory_instances instance WHERE instance.player_id=player.id AND instance.status='placed'),0) home_charm,
                CAST(COALESCE(cube.raid_percent,0) AS CHAR) personal_cube_percent,COALESCE(guild_cube.raid_units,0) guild_cube_units,
                pet.version pet_version,
                COALESCE((SELECT SUM(stack.version+item.version) FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=player.id),0) item_version,
                COALESCE(cube.version,0) personal_cube_version,COALESCE(guild_cube.version,0) guild_cube_version
           FROM players player JOIN player_pets pet ON pet.player_id=player.id
      LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
      LEFT JOIN owned_mini_pets mini ON mini.player_id=player.id AND mini.equipped=TRUE
            AND mini.id=(SELECT MIN(candidate.id) FROM owned_mini_pets candidate WHERE candidate.player_id=player.id AND candidate.equipped=TRUE)
      LEFT JOIN player_homes home ON home.player_id=player.id
      LEFT JOIN player_home_badge_cubes cube ON cube.player_id=player.id AND cube.equipped=TRUE
            AND cube.badge_code=(SELECT MIN(candidate.badge_code) FROM player_home_badge_cubes candidate WHERE candidate.player_id=player.id AND candidate.equipped=TRUE)
      LEFT JOIN guild_members membership ON membership.player_id=player.id
      LEFT JOIN guilds guild ON guild.id=membership.guild_id AND guild.status='active'
      LEFT JOIN guild_overall_charm_cube_options guild_cube ON guild_cube.guild_id=guild.id
          WHERE player.status='active' AND player.deleted_at IS NULL AND pet.display_name IS NOT NULL AND pet.display_name<>''
       ORDER BY player.id`
      );
      const mapped=source.map(row=>mapSource(row)).filter(row=>row.finalRaidCharm>5n);
      mapped.sort(compareRows);
      const sourceVersion=createHash("sha256").update(source.map(versionLine).join("|")).digest("hex");
      const snapshot=(await transaction.execute(
        "INSERT INTO raid_charm_rank_snapshots(operation_id,source_version,eligible_count) VALUES(?,?,?)",
        [operation,sourceVersion,mapped.length]
      )).insertId;
      for(let index=0;index<mapped.length;index+=1){const row=mapped[index]!;await transaction.execute(
        "INSERT INTO raid_charm_rank_entries(snapshot_id,ordinal_value,player_id,pet_id,source_order,pet_image,pet_title,pet_name,item_raid_charm,pet_experience,mini_pet_raid_charm,home_charm,personal_cube_percent,guild_cube_units,final_raid_charm) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [snapshot,index+1,row.playerId,row.petId,row.sourceOrder?.toString()??null,row.petImage,row.petTitle,row.petName,row.itemRaidCharm.toString(),row.petExperience.toString(),row.miniPetRaidCharm.toString(),row.homeCharm.toString(),row.personalCubePercent,row.guildCubeUnits.toString(),row.finalRaidCharm.toString()]
      );}
      const data=formatRaidCharmRanking(mapped);
      const outbox=(await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation,input.channelId,JSON.stringify({data})]
      )).insertId;
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'RAID_CHARM_RANKING_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,operation]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',NULL,'raid_charm_rank_snapshot',?,'raid.charm_ranking.read','success','Iris /레이드매력순위',?,UTC_TIMESTAMP(3))",[operation,snapshot,JSON.stringify({sourceVersion,rowCount:mapped.length,stablePlayerIds:mapped.map(row=>row.playerId),domainMutation:false})]);
      const result:RaidCharmRankingResult={status:"completed",data,snapshotId:snapshot.toString(),outboxId:outbox.toString(),rowCount:mapped.length,sourceVersion,replayed:false};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation]);
      return result;
    });
  }
}

function mapSource(row:SourceRow):RaidCharmRankingRow{
  const value=(input:Numeric|null)=>input==null?0n:BigInt(input);
  const mapped={playerId:String(row.player_id),petId:String(row.pet_id),sourceOrder:row.source_order==null?null:BigInt(row.source_order),petImage:row.pet_image??"",petTitle:row.pet_title??"",petName:row.pet_name,itemRaidCharm:value(row.item_raid_charm),petExperience:value(row.pet_experience),miniPetRaidCharm:value(row.mini_pet_raid_charm),homeCharm:value(row.home_charm),personalCubePercent:row.personal_cube_percent??"0",guildCubeUnits:value(row.guild_cube_units),finalRaidCharm:0n};
  mapped.finalRaidCharm=calculateRaidCharmScore(mapped);return mapped;
}

function versionLine(row:SourceRow):string{return [row.player_id,row.pet_id,row.source_order??"",row.pet_image??"",row.pet_title??"",row.pet_name,row.item_raid_charm,row.pet_experience,row.mini_pet_raid_charm,row.home_charm,row.personal_cube_percent??"0",row.guild_cube_units??0,row.pet_version,row.item_version,row.personal_cube_version,row.guild_cube_version].join(":");}
function compareRows(left:RaidCharmRankingRow,right:RaidCharmRankingRow):number{if(left.finalRaidCharm!==right.finalRaidCharm)return left.finalRaidCharm>right.finalRaidCharm?-1:1;if(left.sourceOrder!==null&&right.sourceOrder!==null&&left.sourceOrder!==right.sourceOrder)return left.sourceOrder<right.sourceOrder?-1:1;if(left.sourceOrder!==null&&right.sourceOrder===null)return-1;if(left.sourceOrder===null&&right.sourceOrder!==null)return 1;return BigInt(left.playerId)<BigInt(right.playerId)?-1:BigInt(left.playerId)>BigInt(right.playerId)?1:0;}
function parsePercentMilli(value:string):bigint{const match=/^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());return match===null?0n:BigInt(match[1]!)*1000n+BigInt((match[2]??"").padEnd(3,"0"));}
function rankPrefix(rank:number):string{return rank===1?"🥇. ":rank===2?"🥈. ":rank===3?"🥉. ":`${rank<10?" ":""}${rank}. `;}
function commas(value:bigint):string{return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function eventKey(eventId:string):string{return eventId.length<=191?eventId:`sha256:${createHash("sha256").update(eventId).digest("hex")}`;}
function stored(value:string|RaidCharmRankingResult):RaidCharmRankingResult{return typeof value==="string"?JSON.parse(value) as RaidCharmRankingResult:value;}
