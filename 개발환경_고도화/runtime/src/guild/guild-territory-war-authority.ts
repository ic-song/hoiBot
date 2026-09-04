import { ApplicationError } from "../shared/application-error.js";

export type GuildTerritoryWarLifecycle = "READY" | "PENDING_START" | "ACTIVE_OPENING" | "ACTIVE_READY";

// 영지전 lifecycle과 active가 가리키는 단일 공성 활성 상태를 검증해 반환합니다.
export function resolveGuildTerritoryWarAuthority(active: boolean | number, lifecycle: string): boolean {
  if (active !== true && active !== false && active !== 0 && active !== 1) {
    throw new ApplicationError(
      "GUILD_TERRITORY_AUTHORITY_CONFLICT",
      "길드 영지전 활성 상태가 서로 일치하지 않습니다.",
      409
    );
  }
  const activeValue = active === true || active === 1;
  const inactiveLifecycle = lifecycle === "READY" || lifecycle === "PENDING_START";
  const activeLifecycle = lifecycle === "ACTIVE_OPENING" || lifecycle === "ACTIVE_READY";
  if ((inactiveLifecycle && !activeValue) || (activeLifecycle && activeValue)) return activeValue;
  throw new ApplicationError(
    "GUILD_TERRITORY_AUTHORITY_CONFLICT",
    "길드 영지전 활성 상태가 서로 일치하지 않습니다.",
    409
  );
}
