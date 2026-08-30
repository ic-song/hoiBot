import { ApplicationError } from "../shared/application-error.js";
import { PASS_SEMANTIC_CODES, type PassSemanticCode } from "./pass-code-resolver.js";
import type { PassEntitlementKind } from "./pass-canonical-ownership-repository.js";
import type { PassCanonicalOwnershipProvider, PassOwnershipMutationResult } from "./pass-canonical-ownership-provider.js";

export interface PassOwnershipServiceRequest{playerId:string;semanticCode:string;action:"grant"|"remove";entitlementKind?:PassEntitlementKind;endDate?:string|null;expectedVersion?:string|null;idempotencyKey:string;}
const isSemantic=(value:string):value is PassSemanticCode=>(PASS_SEMANTIC_CODES as readonly string[]).includes(value);

// typed pass identity와 버전 입력을 검증한 뒤 canonical provider에 위임합니다.
export class PassCanonicalOwnershipService{
 constructor(private readonly provider:Pick<PassCanonicalOwnershipProvider,"mutate">){}
 async execute(request:PassOwnershipServiceRequest):Promise<PassOwnershipMutationResult>{
  if(!isSemantic(request.semanticCode))throw new ApplicationError("PASS_OWNERSHIP_CODE_INVALID","지원 패스 코드를 확인해 주세요.",422);
  if(!/^\d+$/.test(request.playerId)||BigInt(request.playerId)===0n)throw new ApplicationError("PASS_OWNERSHIP_PLAYER_INVALID","플레이어 ID를 확인해 주세요.",422);
  if(request.idempotencyKey.trim()==="")throw new ApplicationError("PASS_OWNERSHIP_IDEMPOTENCY_REQUIRED","멱등 키가 필요합니다.",422);
  const endDate=request.endDate??null;if(endDate!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(endDate))throw new ApplicationError("PASS_OWNERSHIP_END_DATE_INVALID","패스 종료일을 확인해 주세요.",422);
  const expected=request.expectedVersion==null?null:/^\d+$/.test(request.expectedVersion)?BigInt(request.expectedVersion):null;if(request.expectedVersion!=null&&expected===null)throw new ApplicationError("PASS_OWNERSHIP_VERSION_INVALID","패스 버전을 확인해 주세요.",422);
  return this.provider.mutate({playerId:BigInt(request.playerId),semanticCode:request.semanticCode,action:request.action,entitlementKind:endDate===null?"permanent":request.entitlementKind??"dated",endDate,expectedVersion:expected,idempotencyKey:request.idempotencyKey});
 }
}
