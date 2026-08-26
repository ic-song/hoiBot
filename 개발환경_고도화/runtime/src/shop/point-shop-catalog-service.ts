import type { PointShopCatalogCommand } from "./point-shop-catalog-command.js";
import { PointShopCatalogError } from "./point-shop-catalog-command.js";

export interface PointShopCatalogEntry {
  productId: string;
  productKey: string;
  displayName: string;
  displayOrder: number;
  price: bigint;
  rowVersion: bigint;
}

export interface PointShopCatalogSnapshot {
  catalogVersion: bigint;
  taxRateBasisPoints: number;
  lordGuildName?: string;
  entries: readonly PointShopCatalogEntry[];
}

export interface PointShopCatalogMutationRequest {
  requestKey: string;
  actorOperatorId: string;
  expectedCatalogVersion: bigint;
  commandCode: "POINT_SHOP_CATALOG_UPSERT" | "POINT_SHOP_CATALOG_REMOVE";
  replyDestinationId?: string;
  mutation:
    | { action: "UPSERT"; displayName: string; price: bigint; displayOrder: number }
    | { action: "REMOVE"; productId: string };
}

export interface PointShopCatalogMutationResult {
  replayed: boolean;
  catalogVersion: bigint;
  productId: string;
  message: string;
  outboxId?: string;
}

export interface PointShopCatalogRepository {
  findReplay(requestKey: string): Promise<PointShopCatalogMutationResult | undefined>;
  readSnapshot(): Promise<PointShopCatalogSnapshot>;
  mutate(request: PointShopCatalogMutationRequest): Promise<PointShopCatalogMutationResult>;
}

// 레거시 상점의 번호·가격·세율·성주 길드 의미를 DB projection으로 표시합니다.
export function formatPointShopCatalog(snapshot: PointShopCatalogSnapshot): string {
  const products = snapshot.entries.length === 0
    ? "등록된 상품이 없습니다."
    : snapshot.entries.map((entry, index) => `${index + 1}. ${entry.displayName} : ${entry.price.toLocaleString("en-US")} Point`).join("\n");
  const taxRate = (snapshot.taxRateBasisPoints / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `🏪 포인트 상점\n${products}\n\n세율 : ${taxRate}%\n성주 길드 : ${snapshot.lordGuildName ?? "없음"}`;
}

export class PointShopCatalogService {
  public constructor(private readonly repository: PointShopCatalogRepository) {}

  // 현재 활성 상점 projection을 읽어 사용자 표시 문자열로 변환합니다.
  public async read(): Promise<{ snapshot: PointShopCatalogSnapshot; message: string }> {
    const snapshot = await this.repository.readSnapshot();
    return { snapshot, message: formatPointShopCatalog(snapshot) };
  }

  // 관리자 추가·삭제를 versioned stable product ID mutation으로 실행합니다.
  public async executeMutation(input: {
    command: Exclude<PointShopCatalogCommand, { kind: "READ" }>;
    requestKey: string;
    actorOperatorId: string;
    replyDestinationId?: string;
  }): Promise<PointShopCatalogMutationResult> {
    const replay = await this.repository.findReplay(input.requestKey);
    if (replay) return replay;
    const snapshot = await this.repository.readSnapshot();
    if (input.command.kind === "UPSERT") {
      return this.repository.mutate({
        requestKey: input.requestKey,
        actorOperatorId: input.actorOperatorId,
        expectedCatalogVersion: snapshot.catalogVersion,
        commandCode: "POINT_SHOP_CATALOG_UPSERT",
        replyDestinationId: input.replyDestinationId,
        mutation: {
          action: "UPSERT",
          displayName: input.command.displayName,
          price: input.command.price,
          displayOrder: snapshot.entries.length + 1,
        },
      });
    }
    const target = snapshot.entries[input.command.listNumber - 1];
    if (!target) throw new PointShopCatalogError("POINT_SHOP_NUMBER_INVALID", "상점 번호를 확인해 주세요.");
    return this.repository.mutate({
      requestKey: input.requestKey,
      actorOperatorId: input.actorOperatorId,
      expectedCatalogVersion: snapshot.catalogVersion,
      commandCode: "POINT_SHOP_CATALOG_REMOVE",
      replyDestinationId: input.replyDestinationId,
      mutation: { action: "REMOVE", productId: target.productId },
    });
  }
}
