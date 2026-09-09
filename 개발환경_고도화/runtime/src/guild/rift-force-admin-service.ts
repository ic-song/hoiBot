import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { GuildTerritoryWarProvider, type ForcedRiftKind, type ForcedRiftResult } from "./guild-territory-war-provider.js";

export type RiftForceAdminResult=ForcedRiftResult|{status:"handled_no_reply"};

// DEV 강제 균열은 두 정확 일치 명령만 후보로 허용합니다.
export function parseRiftForceAdminCommand(message:string|undefined):ForcedRiftKind|null{
  if(message==="/강제균열")return "rift";if(message==="/강제대균열")return "greatRift";return null;
}

// 운영 Node 환경에서는 레거시 DEV 전용 명령을 실행하지 않습니다.
export function isRiftForceDevelopmentContext(nodeEnv:string):boolean{return nodeEnv!=="production";}

// DEV 컨텍스트와 연결 사용자를 확인한 뒤 공용 영지전 provider를 호출합니다.
export class RiftForceAdminService{
  constructor(private readonly database:DatabaseClient,private readonly provider=new GuildTerritoryWarProvider(database)){}
  async handle(input:{externalUserId:string;channelId:string;message:string;eventId:string;nodeEnv:string}):Promise<RiftForceAdminResult>{
    const kind=parseRiftForceAdminCommand(input.message);if(kind===null)throw new ApplicationError("INVALID_RIFT_FORCE_COMMAND","강제 균열 명령 형식이 올바르지 않습니다.",422);
    if(!isRiftForceDevelopmentContext(input.nodeEnv))return{status:"handled_no_reply"};
    const actors=await this.database.query<Array<{player_id:bigint}>>("SELECT identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND identity.player_id IS NOT NULL LIMIT 1",[input.externalUserId]);
    const actor=actors[0];if(actor===undefined)return{status:"handled_no_reply"};
    return this.provider.force({eventId:input.eventId,actorPlayerId:actor.player_id.toString(),destinationId:input.channelId,warKey:"current",kind});
  }
}

// partial dispatch 후보를 exact 명령으로 제한합니다.
export function isRiftForceAdminCommand(message:string|undefined):boolean{return parseRiftForceAdminCommand(message)!==null;}
