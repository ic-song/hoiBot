import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { parsePointShopCatalogCommand, PointShopCatalogError } from "./point-shop-catalog-command.js";
import { MariaPointShopCatalogRepository } from "./maria-point-shop-catalog-repository.js";
import { PointShopCatalogService } from "./point-shop-catalog-service.js";

// Iris identity를 조회 사용자 또는 권한 있는 운영자로 해석해 상점 명령을 실행합니다.
export class PointShopCatalogIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ commandCode: string; message: string; replayed: boolean; outboxId?: string }> {
    if (!event.userId || !event.channelId || !event.message) {
      throw new PointShopCatalogError("POINT_SHOP_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.");
    }
    const command = parsePointShopCatalogCommand(event.message);
    if (!command) throw new PointShopCatalogError("POINT_SHOP_COMMAND_INVALID", "상점 명령 형식을 확인해 주세요.");
    const service = new PointShopCatalogService(new MariaPointShopCatalogRepository(this.database));
    if (command.kind === "READ") {
      const result = await service.read();
      return { commandCode: "POINT_SHOP_CATALOG_READ", message: result.message, replayed: false };
    }
    const operators = await this.database.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=?
         AND identity.status='linked' AND operator.status='active'
       ORDER BY mapping.operator_id LIMIT 2`,
      [event.userId],
    );
    if (operators.length !== 1) throw new PointShopCatalogError("FORBIDDEN", "상점 관리 권한이 없습니다.");
    const result = await service.executeMutation({
      command,
      requestKey: event.eventId,
      actorOperatorId: operators[0]!.operator_id.toString(),
      replyDestinationId: event.channelId,
    });
    if (!result.outboxId) throw new Error("POINT_SHOP_CATALOG_OUTBOX_NOT_CREATED");
    return {
      commandCode: command.kind === "UPSERT" ? "POINT_SHOP_CATALOG_UPSERT" : "POINT_SHOP_CATALOG_REMOVE",
      message: result.message,
      replayed: result.replayed,
      outboxId: result.outboxId,
    };
  }
}
