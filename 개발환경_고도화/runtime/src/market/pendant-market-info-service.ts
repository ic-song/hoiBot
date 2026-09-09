import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const GRADES: Record<string, { charm: bigint; explore: number }> = {
  "최하급": { charm: 200000n, explore: 0.3 }, "하급": { charm: 500000n, explore: 0.4 }, "하급+": { charm: 1000000n, explore: 0.5 },
  "중급": { charm: 2000000n, explore: 0.6 }, "중급+": { charm: 3000000n, explore: 0.7 }, "상급": { charm: 4000000n, explore: 0.9 },
  "상급+": { charm: 5000000n, explore: 1 }, "최상급": { charm: 6000000n, explore: 1.1 }, "최상급+": { charm: 7000000n, explore: 1.2 },
  "신화": { charm: 8000000n, explore: 1.3 }, "초월": { charm: 10000000n, explore: 1.5 }, "창세": { charm: 15000000n, explore: 2 }, "창조": { charm: 20000000n, explore: 2.5 }
};
const UPGRADES = [null,
  [100,5000n,0.1,1000000000n,1n],[100,10000n,0.2,1000000000n,2n],[100,15000n,0.3,1000000000n,3n],[100,20000n,0.4,1000000000n,4n],[100,25000n,0.5,1000000000n,5n],[100,30000n,0.6,1000000000n,6n],
  [33,250000n,0.7,3000000000n,7n],[33,375000n,0.8,3000000000n,8n],[33,500000n,0.9,3000000000n,9n],[33,750000n,1,3000000000n,10n],
  [10,1000000n,1.1,10000000000n,11n],[10,1250000n,1.2,10000000000n,12n],[10,1500000n,1.3,10000000000n,13n],[10,2000000n,1.4,10000000000n,14n],
  [5,2500000n,1.5,15000000000n,15n],[5,3000000n,1.6,15000000000n,16n],[5,3500000n,1.7,15000000000n,17n],[5,4000000n,1.8,15000000000n,18n],[5,4500000n,1.9,15000000000n,19n],[5,5000000n,2,15000000000n,20n],
  [3,6000000n,2.1,20000000000n,21n],[3,7000000n,2.2,20000000000n,22n],[3,8000000n,2.3,20000000000n,23n],[2,9000000n,2.4,30000000000n,24n],[2,10000000n,2.5,30000000000n,25n],
  [1,12500000n,2.6,100000000000n,26n],[1,15000000n,2.7,100000000000n,27n],[1,17500000n,2.8,100000000000n,28n],[1,25000000n,2.9,100000000000n,29n],[1,30000000n,3,100000000000n,30n]
] as const;

type Parsed = { kind: "usage" } | { kind: "invalid" } | { kind: "lookup"; displayNo: bigint };
interface Actor { identity_id: bigint; player_id: bigint; }
interface ListingRow { listing_id: bigint; asset_type_code: string; inventory_instance_id: bigint | null; object_type: string | null; item_name: string | null; name_value: string | null; icon_value: string | null; grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null; }
export interface PendantMarketInfoResult { status: "usage" | "invalid" | "not_found" | "not_pendant" | "unavailable" | "found" | "silent"; data?: string; outboxId?: string; listingId?: string; instanceId?: string; }

// 레거시 무인자·자유 형식 outer guard와 숫자 전용 inner guard를 구분합니다.
export function parsePendantMarketInfoCommand(message: string | undefined): Parsed | undefined {
  if (message === "/펜던트거래정보") return { kind: "usage" };
  if (message === undefined || !/^\/펜던트거래정보\s+.+$/.test(message)) return undefined;
  const match = /^\/펜던트거래정보\s+(\d+)$/.exec(message);
  return match === null ? { kind: "invalid" } : { kind: "lookup", displayNo: BigInt(match[1]!) };
}

// 레거시 outer guard에 들어오는 명령만 partial dispatch 후보로 허용합니다.
export function isPendantMarketInfoCommandCandidate(message: string | undefined): boolean { return parsePendantMarketInfoCommand(message) !== undefined; }

// 인자형 조회를 DB 대표 alias로 정규화합니다.
export function normalizePendantMarketInfoDispatchMessage(message: string): string { return isPendantMarketInfoCommandCandidate(message) ? "/펜던트거래정보" : message; }

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function comma(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function percent(value: number): string { return value.toFixed(Math.abs(value) < 1 ? 2 : 1).replace(/\.?0+$/, ""); }

// DB attributes를 레거시 펜던트 상세정보 문구로 투영합니다.
export function formatPendantMarketInfo(row: ListingRow): string {
  const grade = row.grade_value!; const base = GRADES[grade] ?? GRADES["최하급"]!;
  const level = Math.max(0, Math.min(30, Number(row.upgrade_value ?? "0")));
  let upgradeCharm = 0n; for (let index=1; index<=level; index++) upgradeCharm += UPGRADES[index]![1];
  const upgradeExplore = level === 0 ? 0 : UPGRADES[level]![2];
  const icon = row.icon_value !== null && !(row.name_value ?? row.item_name ?? "").endsWith(row.icon_value) ? row.icon_value : "";
  const name = `${row.name_value ?? row.item_name}${icon}[${grade}][⚒️${row.durability_value ?? "0"}/${row.max_durability_value ?? "5"}](+${level})`;
  let out = `펜던트 거래정보:\n${name}\n━━━━━━━━━━━━━\n`;
  out += `기본 종합매력👑: ${comma(base.charm)}💞\n강화 종합매력👑: +${comma(upgradeCharm)}💞\n총 종합매력👑: ${comma(base.charm+upgradeCharm)}💞\n\n`;
  out += `기본 펫탐험성공확률⛰️: +${percent(base.explore)}%\n강화 펫탐험성공확률⛰️: +${percent(upgradeExplore)}%\n총 펫탐험성공확률⛰️: +${percent(base.explore+upgradeExplore)}%\n\n`;
  out += `남은 내구도⚒️: ${row.durability_value ?? "0"}회\n`;
  if (level >= 30) return out + "이미 최대 강화 단계입니다.";
  const next = UPGRADES[level+1]!;
  return out + `다음 강화성공 확률🎲: ${next[0]}%\n다음 강화비용💸: 🅟${comma(next[3])}\n필요 강화석📿: ${next[4]}개`;
}

async function complete(transaction: DatabaseTransaction,input:{operationId:bigint;eventId:string;destinationId:string;actor:Actor;resultCode:string;data:string;result:PendantMarketInfoResult;summary:Record<string,unknown>}):Promise<PendantMarketInfoResult>{
  const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.operationId,input.destinationId,JSON.stringify({data:input.data})]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_MARKET_INFO',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.eventId,input.operationId,input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'market_listing',?,'market.pendant.info',?,'Iris /펜던트거래정보',?,UTC_TIMESTAMP(3))",[input.operationId,input.actor.identity_id,input.result.listingId??null,input.resultCode,JSON.stringify(input.summary)]);
  const result={...input.result,data:input.data,outboxId:outbox.insertId.toString()}; await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),input.operationId]); return result;
}

// 전체 open 매물 최신순 표시번호를 펜던트 상세 projection으로 읽습니다.
export class PendantMarketInfoService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input:{eventId:string;externalUserId:string;destinationId:string;message:string}):Promise<PendantMarketInfoResult>{
    const parsed=parsePendantMarketInfoCommand(input.message); if(parsed===undefined)return{status:"silent"};
    return this.database.withTransaction(async(transaction)=>{
      const actors=await transaction.query<Actor[]>("SELECT identity.id identity_id,identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE",[input.externalUserId]);
      const actor=actors[0]; if(actor===undefined)return{status:"silent"}; const key=eventKey(input.eventId);
      const prior=await transaction.query<Array<{result_json:string|PendantMarketInfoResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope='market.pendant.info' AND idempotency_key=? FOR UPDATE",[key]);
      if(prior[0]?.result_json!=null)return typeof prior[0].result_json==="string"?JSON.parse(prior[0].result_json):prior[0].result_json;
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.pendant.info',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),key,actor.identity_id]);
      if(parsed.kind!=="lookup"){
        const data=parsed.kind==="usage"?"사용법: /펜던트거래정보 [자유시장번호]\n예시: /펜던트거래정보 3":"자유시장 번호는 숫자로 입력해주세요.\n예시: /펜던트거래정보 3";
        return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,resultCode:parsed.kind,data,result:{status:parsed.kind},summary:{mutation:false}});
      }
      let listing:ListingRow|undefined;
      if(parsed.displayNo>0n&&parsed.displayNo<=2147483647n){
        const rows=await transaction.query<ListingRow[]>(`SELECT listing.id listing_id,listing.asset_type_code,listing.inventory_instance_id,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType'))) object_type,
          item.display_name item_name,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
          JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
          JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
          FROM market_listings listing LEFT JOIN inventory_instances instance ON instance.id=listing.inventory_instance_id LEFT JOIN item_definitions item ON item.id=listing.item_id
          WHERE listing.status='open' AND (listing.expires_at IS NULL OR listing.expires_at>UTC_TIMESTAMP(3)) ORDER BY listing.created_at DESC,listing.id DESC LIMIT 1 OFFSET ?`,[parsed.displayNo-1n]); listing=rows[0];
      }
      let result:PendantMarketInfoResult; let data:string;
      if(listing===undefined){result={status:"not_found"};data="해당 자유시장 번호의 거래 정보를 찾을 수 없습니다.";}
      else if(listing.object_type!=="pendant"){result={status:"not_pendant",listingId:listing.listing_id.toString()};data="해당 거래 아이템은 펜던트가 아닙니다.\n펜던트 거래정보는 자유시장에 등록된 펜던트만 확인할 수 있습니다.";}
      else if(listing.inventory_instance_id===null||listing.name_value===null||listing.grade_value===null){result={status:"unavailable",listingId:listing.listing_id.toString()};data="해당 펜던트 정보를 불러올 수 없습니다.\n관리자에게 문의해주세요.";}
      else{result={status:"found",listingId:listing.listing_id.toString(),instanceId:listing.inventory_instance_id.toString()};data=formatPendantMarketInfo(listing);}
      return complete(transaction,{operationId:operation.insertId,eventId:input.eventId,destinationId:input.destinationId,actor,resultCode:result.status,data,result,summary:{displayNo:parsed.displayNo.toString(),listingId:result.listingId??null,mutation:false}});
    });
  }
}
