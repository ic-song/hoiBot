export type PointShopCatalogCommand =
  | { kind: "READ" }
  | { kind: "UPSERT"; displayName: string; price: bigint }
  | { kind: "REMOVE"; listNumber: number };

import { isDiamondShopReadCommandCandidate, normalizeDiamondShopReadDispatchMessage } from "./diamond-shop-read-service.js";
import { isDiamondShopBuyCommandCandidate, normalizeDiamondShopBuyDispatchMessage } from "./diamond-shop-buy-service.js";
import { isPointShopBuyCommandCandidate, normalizePointShopBuyDispatchMessage } from "./point-shop-buy-service.js";

export class PointShopCatalogError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// 포인트 상점 조회·추가·삭제 명령을 접미 문구 없이 전체 패턴으로 해석합니다.
export function parsePointShopCatalogCommand(message: string): PointShopCatalogCommand | undefined {
  if (message === "/상점") return { kind: "READ" };
  const upsert = /^\/상점추가\s+(.+?)\s+(\d{1,27})$/.exec(message);
  if (upsert) {
    const displayName = upsert[1]!.trim();
    if (displayName.length === 0) return undefined;
    return { kind: "UPSERT", displayName, price: BigInt(upsert[2]!) };
  }
  const remove = /^\/상점삭제\s+([1-9]\d*)$/.exec(message);
  if (remove) {
    const listNumber = Number(remove[1]);
    return Number.isSafeInteger(listNumber) ? { kind: "REMOVE", listNumber } : undefined;
  }
  return undefined;
}

// 공용 dispatcher가 인자형 명령을 command_aliases 기본 명령어로 찾도록 정규화합니다.
export function normalizePointShopCatalogDispatchMessage(message: string): string {
  if (isPointShopBuyCommandCandidate(message)) return normalizePointShopBuyDispatchMessage(message);
  if (isDiamondShopReadCommandCandidate(message)) return normalizeDiamondShopReadDispatchMessage(message);
  if (isDiamondShopBuyCommandCandidate(message)) return normalizeDiamondShopBuyDispatchMessage(message);
  const command = parsePointShopCatalogCommand(message);
  if (command?.kind === "UPSERT") return "/상점추가";
  if (command?.kind === "REMOVE") return "/상점삭제";
  return command?.kind === "READ" ? "/상점" : message;
}

// 상점 명령 후보를 정확한 전체 입력 패턴으로 제한합니다.
export function isPointShopCatalogCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (parsePointShopCatalogCommand(message) !== undefined
    || isPointShopBuyCommandCandidate(message) || isDiamondShopReadCommandCandidate(message) || isDiamondShopBuyCommandCandidate(message));
}
