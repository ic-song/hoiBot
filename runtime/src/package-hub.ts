import type { RepositoryPackageCatalogProvider } from "./package-provider.js";

export interface PackageInventoryStack { itemId: string; quantity: bigint; }
export interface PackageInventoryReader {
  list(userId: string): Promise<readonly PackageInventoryStack[]>;
}
export interface PackageBagEntry {
  bagNumber: number;
  packageId: string;
  displayName: string;
  consumeItemId: string;
  quantity: bigint;
}

// DB 카탈로그와 통합 아이템 보유량을 조합해 패키지 가방 순번을 만듭니다.
export class PackageHubService {
  constructor(
    private readonly catalog: RepositoryPackageCatalogProvider,
    private readonly inventory: PackageInventoryReader
  ) {}

  async listBag(userId: string): Promise<readonly PackageBagEntry[]> {
    const [snapshot, stacks] = await Promise.all([this.catalog.getSnapshot(), this.inventory.list(userId)]);
    const quantityByItem = new Map(stacks.map((stack) => [stack.itemId, stack.quantity]));
    return snapshot.packages
      .filter((entry) => entry.enabled && (quantityByItem.get(entry.consumeItemId) ?? 0n) > 0n)
      .map((entry, index) => ({
        bagNumber: index + 1,
        packageId: entry.id,
        displayName: entry.displayName,
        consumeItemId: entry.consumeItemId,
        quantity: quantityByItem.get(entry.consumeItemId) as bigint
      }));
  }
}
