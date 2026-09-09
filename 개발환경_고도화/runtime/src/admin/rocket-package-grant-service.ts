import type { DatabaseClient } from "../database.js";
import { AdminStackGrantService,type AdminStackGrantCommand,type AdminStackGrantResult } from "./admin-stack-grant-service.js";

export type RocketPackageGrantCommand=AdminStackGrantCommand&{rocketNo:number};
export type RocketPackageGrantResult=AdminStackGrantResult;

const PREFIXES=Array.from({length:10},(_,index)=>`/로켓${index+1}, `);

// 레거시 배열과 동일한 `/로켓1, `~`/로켓10, ` prefix만 후보로 허용합니다.
export function isRocketPackageGrantCommandCandidate(message:string|undefined):boolean{return message!==undefined&&PREFIXES.some(prefix=>message.startsWith(prefix));}

// 레거시 split(", ") cardinality와 번호별 정확한 대상 키를 보존합니다.
export function parseRocketPackageGrantCommand(message:string):RocketPackageGrantCommand|null{
  const rocketNo=PREFIXES.findIndex(prefix=>message.startsWith(prefix))+1;if(rocketNo===0)return null;
  const parts=message.split(", ");if(parts.length!==2)return null;return{amount:1n,targetLegacyKey:parts[1]!.trim(),rocketNo};
}

// 번호별 exact itemName/reply를 공용 관리자 owner와 canonical item participant에 전달합니다.
export class RocketPackageGrantService{
  constructor(private readonly database:DatabaseClient){}
  grant(input:{eventId:string;destinationId:string;operatorId:string;message:string}):Promise<RocketPackageGrantResult>{
    const parsed=parseRocketPackageGrantCommand(input.message),rocketNo=parsed?.rocketNo??PREFIXES.findIndex(prefix=>input.message.startsWith(prefix))+1,itemName=`로켓배송패키지🚀[${rocketNo}](/호팡오픈${rocketNo})`;
    return new AdminStackGrantService(this.database).grantCanonical({eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,command:parsed},{commandCode:"ADMIN_ROCKET_PACKAGE_GRANT",itemCode:`LEGACY-ROCKET-PACKAGE-${rocketNo}`,itemName,idempotencyScope:"admin.rocket_package.grant",actionCode:"inventory.rocket_package.grant",reasonCode:"ADMIN_ROCKET_PACKAGE_GRANT",canonicalReasonType:"ADMIN_ROCKET_PACKAGE_GRANT",auditReason:`Iris 총괄 운영자 /로켓${rocketNo}`,canonicalSourceSystems:["LEGACY_JSON","LEGACY_DB"],usageMessage:`명령어 형식이 잘못되었습니다. 올바른 형식: /로켓${rocketNo}, 사용자아이디`,invalidAmountMessage:"지급 개수는 1개 이상이어야 합니다.",noTargetMessage:"해당 사용자를 찾을 수 없습니다.",formatGranted:target=>`[${target}]님에게 ${itemName}가 지급되었습니다.`});
  }
}
