import type { DatabaseClient } from "../database.js";
import { AdminStackGrantService,type AdminStackGrantCommand,type AdminStackGrantResult } from "./admin-stack-grant-service.js";

export type PetSkillBookGrantCommand=AdminStackGrantCommand;

// 레거시 `/펫북[수량], 대상키` 전체 형식만 관리자 지급 후보로 허용합니다.
export function isPetSkillBookGrantCommandCandidate(message:string|undefined):boolean{return message!==undefined&&/^\/펫북\d*,.*$/.test(message);}

// 생략 수량 1과 쉼표 뒤의 공백 포함 회원 키를 보존해 파싱합니다.
export function parsePetSkillBookGrantCommand(message:string):PetSkillBookGrantCommand{const match=/^\/펫북(\d*)?,\s*(.+)$/.exec(message);if(match===null)return null;return{amount:BigInt(match[1]==null||match[1]===""?"1":match[1]),targetLegacyKey:match[2]!.trim()};}

// 공용 stack 지급 provider에 펫스킬북의 레거시 계약을 전달합니다.
export class PetSkillBookGrantService{constructor(private readonly database:DatabaseClient){}grant(input:{eventId:string;destinationId:string;operatorId:string;message:string}):Promise<AdminStackGrantResult>{return new AdminStackGrantService(this.database).grant({eventId:input.eventId,destinationId:input.destinationId,operatorId:input.operatorId,command:parsePetSkillBookGrantCommand(input.message)},{commandCode:"ADMIN_PET_SKILL_BOOK_GRANT",itemCode:"pet_skill_book",itemName:"펫스킬북📙(/펫스킬오픈)",idempotencyScope:"admin.pet_skill_book.grant",actionCode:"inventory.pet_skill_book.grant",reasonCode:"ADMIN_PET_SKILL_BOOK_GRANT",auditReason:"Iris 총괄 운영자 /펫북",usageMessage:"올바른 형식으로 입력해 주세요. 예: /특성10, 유저아이디",invalidAmountMessage:"지급 개수는 1개 이상이어야 합니다.",noTargetMessage:"유저 아이디를 확인해 주세요.",formatGranted:(target,amount)=>`${target}님에게 펫스킬북📙(/펫스킬오픈) ${amount.toString()}개를 지급했습니다.`});}}
