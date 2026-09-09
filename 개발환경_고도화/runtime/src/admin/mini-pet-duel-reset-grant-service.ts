import type { DatabaseClient } from "../database.js";
import { AdminStackGrantService,type AdminStackGrantCommand,type AdminStackGrantResult } from "./admin-stack-grant-service.js";

export type MiniPetDuelResetGrantCommand=AdminStackGrantCommand;
export type MiniPetDuelResetGrantResult=AdminStackGrantResult;

// 레거시 `/대전[수량], 대상키` 전체 형식만 관리자 지급 후보로 허용합니다.
export function isMiniPetDuelResetGrantCommandCandidate(message:string|undefined):boolean{return message!==undefined&&/^\/대전\d*,.*$/.test(message);}

// 레거시 기본 수량 1과 쉼표 뒤 회원 키를 보존해 파싱합니다.
export function parseMiniPetDuelResetGrantCommand(message:string):MiniPetDuelResetGrantCommand{const match=/^\/대전(\d*)?,\s*(.+)$/.exec(message);if(match===null)return null;return{amount:BigInt(match[1]==null||match[1]===""?"1":match[1]),targetLegacyKey:match[2]!.trim()};}

// 공용 stack 지급 provider에 미니펫 대전 리셋권의 레거시 계약을 전달합니다.
export class MiniPetDuelResetGrantService{constructor(private readonly database:DatabaseClient){}grant(input:{eventId:string;destinationId:string;operatorId:string;message:string}):Promise<MiniPetDuelResetGrantResult>{return new AdminStackGrantService(this.database).grant({eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,command:parseMiniPetDuelResetGrantCommand(input.message)},{commandCode:"ADMIN_MINI_PET_DUEL_RESET_GRANT",itemCode:"ITEM-MINI-PET-DUEL-RESET-TICKET",itemName:"미니펫대전리셋권🐹",idempotencyScope:"admin.mini_pet_duel_reset.grant",actionCode:"inventory.mini_pet_duel_reset.grant",reasonCode:"ADMIN_MINI_PET_DUEL_RESET_GRANT",auditReason:"Iris 총괄 운영자 /대전",usageMessage:"올바른 형식으로 입력해 주세요. 예: /대전10, 유저아이디",invalidAmountMessage:"지급 개수는 1개 이상이어야 합니다.",noTargetMessage:"유저 아이디를 확인해 주세요.",formatGranted:(target,amount)=>`${target}님에게 미니펫대전리셋권🐹 ${amount.toString()}개를 지급했습니다.`});}}
