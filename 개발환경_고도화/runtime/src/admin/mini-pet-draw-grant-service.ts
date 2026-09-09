import type { DatabaseClient } from "../database.js";
import { AdminStackGrantService,type AdminStackGrantCommand,type AdminStackGrantResult } from "./admin-stack-grant-service.js";

export type MiniPetDrawGrantCommand=AdminStackGrantCommand;

// 레거시 `/펫미니[수량], 대상키` 전체 형식만 관리자 지급 후보로 허용합니다.
export function isMiniPetDrawGrantCommandCandidate(message:string|undefined):boolean{return message!==undefined&&/^\/펫미니\d*,.*$/.test(message);}

// 생략 수량 1과 쉼표 뒤의 공백 포함 회원 키를 보존해 파싱합니다.
export function parseMiniPetDrawGrantCommand(message:string):MiniPetDrawGrantCommand{const match=/^\/펫미니(\d*)?,\s*(.+)$/.exec(message);if(match===null)return null;return{amount:BigInt(match[1]==null||match[1]===""?"1":match[1]),targetLegacyKey:match[2]!.trim()};}

// 공용 stack 지급 provider에 미니펫뽑기의 레거시 계약을 전달합니다.
export class MiniPetDrawGrantService{constructor(private readonly database:DatabaseClient){}grant(input:{eventId:string;destinationId:string;operatorId:string;message:string}):Promise<AdminStackGrantResult>{return new AdminStackGrantService(this.database).grant({eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,command:parseMiniPetDrawGrantCommand(input.message)},{commandCode:"ADMIN_MINI_PET_DRAW_GRANT",itemCode:"mini_pet_draw",itemName:"미니펫뽑기🐹(/미니펫오픈)",idempotencyScope:"admin.mini_pet_draw.grant",actionCode:"inventory.mini_pet_draw.grant",reasonCode:"ADMIN_MINI_PET_DRAW_GRANT",auditReason:"Iris 총괄 운영자 /펫미니",usageMessage:"올바른 형식으로 입력해 주세요. 예: /펫미니10, 유저아이디",invalidAmountMessage:"지급 개수는 1개 이상이어야 합니다.",noTargetMessage:"유저 아이디를 확인해 주세요.",formatGranted:(target,amount)=>`${target}님에게 미니펫뽑기🐹(/미니펫오픈) ${amount.toString()}개를 지급했습니다.`});}}
