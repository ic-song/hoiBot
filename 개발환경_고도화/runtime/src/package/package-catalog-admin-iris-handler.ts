import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { PackageCatalogCommandError, parsePackageCatalogAdminCommand } from "./package-catalog-admin-command.js";
import { PackageCatalogAdminService } from "./package-catalog-admin-service.js";
import { MariaPackageCatalogAdminRepository } from "./mariadb-package-catalog-admin.js";

interface OperatorRow {
  operator_id: bigint;
}

// 검증된 Kakao identity를 admin operator로 해석해 카탈로그 mutation을 실행합니다.
export class PackageCatalogAdminIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ commandCode: string; message: string; replayed: boolean; outboxId: string }> {
    if (!event.userId || !event.channelId || !event.message) {
      throw new PackageCatalogCommandError("PACKAGE_ADMIN_IDENTITY_REQUIRED", "관리자 식별 정보를 확인할 수 없습니다.");
    }
    const command = parsePackageCatalogAdminCommand(event.message);
    if (!command) throw new PackageCatalogCommandError("PACKAGE_ADMIN_COMMAND_INVALID", "패키지 관리자 명령 형식을 확인해 주세요.");
    const operators = await this.database.query<OperatorRow[]>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=?
         AND identity.status='linked' AND operator.status='active'
       ORDER BY mapping.operator_id LIMIT 2`,
      [event.userId],
    );
    if (operators.length !== 1) throw new PackageCatalogCommandError("FORBIDDEN", "패키지 관리 권한이 없습니다.");
    const result = await new PackageCatalogAdminService(new MariaPackageCatalogAdminRepository(this.database)).execute({
      command,
      requestKey: event.eventId,
      actorOperatorId: operators[0]!.operator_id.toString(),
      replyDestinationId: event.channelId,
    });
    if (!result.outboxId) throw new Error("PACKAGE_CATALOG_ADMIN_OUTBOX_NOT_CREATED");
    return { commandCode: `PACKAGE_CATALOG_${command.kind}`, message: result.message, replayed: result.replayed, outboxId: result.outboxId };
  }
}
