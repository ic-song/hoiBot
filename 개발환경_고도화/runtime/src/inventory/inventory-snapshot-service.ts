import type { InventorySnapshotInput, InventorySnapshotRepository, InventorySnapshotResult } from "./inventory-snapshot.js";

export function isInventorySnapshotCommand(message: string | undefined): boolean {
  return message === "/소지품저장";
}

// 인벤토리 변경 권한 확인 후 전체 인벤토리 DB 스냅샷 생성을 위임합니다.
export class InventorySnapshotService {
  constructor(private readonly repository: InventorySnapshotRepository) {}

  async handle(input: InventorySnapshotInput): Promise<InventorySnapshotResult> {
    const operatorId = await this.repository.findAuthorizedOperator(input.externalUserId);
    if (operatorId === null) return { status: "ignored_forbidden" };
    return this.repository.save({ ...input, operatorId });
  }
}
