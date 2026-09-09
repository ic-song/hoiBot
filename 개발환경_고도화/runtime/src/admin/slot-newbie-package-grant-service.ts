import type { DatabaseClient } from "../database.js";
import { AdminStackGrantService,type AdminStackGrantCommand,type AdminStackGrantResult } from "./admin-stack-grant-service.js";

export type SlotNewbiePackageGrantCommand=AdminStackGrantCommand&{variantNo:number};
export type SlotNewbiePackageGrantResult=AdminStackGrantResult;

const PREFIXES=["/슬롯초보,","/슬롯초보2,","/슬롯초보3,","/슬롯초보4,"] as const;

// 레거시와 동일한 슬롯초보 4개 prefix만 후보로 허용합니다.
export function isSlotNewbiePackageGrantCommandCandidate(message:string|undefined):boolean{return message!==undefined&&PREFIXES.some(prefix=>message.startsWith(prefix));}

// 레거시 split(",")의 두 번째 값을 대상 키로 사용합니다.
export function parseSlotNewbiePackageGrantCommand(message:string):SlotNewbiePackageGrantCommand|null{
  const variantNo=PREFIXES.findIndex(prefix=>message.startsWith(prefix))+1;if(variantNo===0)return null;
  const targetLegacyKey=message.split(",")[1]?.trim();if(targetLegacyKey===undefined)return null;
  return{amount:1n,targetLegacyKey,variantNo};
}

// 번호별 itemName과 응답을 공용 관리자 transaction owner에 전달합니다.
export class SlotNewbiePackageGrantService{
  constructor(private readonly database:DatabaseClient){}
  grant(input:{eventId:string;destinationId:string;operatorId:string;message:string}):Promise<SlotNewbiePackageGrantResult>{
    const parsed=parseSlotNewbiePackageGrantCommand(input.message),variantNo=parsed?.variantNo??PREFIXES.findIndex(prefix=>input.message.startsWith(prefix))+1,suffix=variantNo===1?"":String(variantNo),itemName=`슬롯초보패키지${suffix}🪙(/슬롯초보오픈${suffix})`;
    return new AdminStackGrantService(this.database).grantCanonical({eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,command:parsed},{commandCode:"ADMIN_SLOT_NEWBIE_PACKAGE_GRANT",itemCode:`LEGACY-SLOT-NEWBIE-PACKAGE-${variantNo}`,itemName,idempotencyScope:"admin.slot_newbie_package.grant",actionCode:"inventory.slot_newbie_package.grant",reasonCode:"ADMIN_SLOT_NEWBIE_PACKAGE_GRANT",canonicalReasonType:"ADMIN_SLOT_NEWBIE_PACKAGE_GRANT",auditReason:`Iris 총괄 운영자 /슬롯초보${suffix}`,canonicalSourceSystems:["LEGACY_JSON","LEGACY_DB"],usageMessage:`명령어 형식이 잘못되었습니다. 올바른 형식: /슬롯초보${suffix}, 사용자아이디`,invalidAmountMessage:"지급 개수는 1개 이상이어야 합니다.",noTargetMessage:"유저 아이디를 확인해 주세요.",formatGranted:target=>`${target}님에게 슬롯초보패키지${suffix}(/슬롯초보오픈${suffix})🪙를 지급했습니다.`});
  }
}
