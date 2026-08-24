import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { PackageCatalogCommandError } from "./package-catalog-admin-command.js";
import { parsePackageCatalogWizardControl } from "./package-catalog-add-wizard.js";
import { PackageCatalogAddWizardService } from "./package-catalog-add-wizard-service.js";
import { MariaDbPackageCatalogAddWizardRepository } from "./mariadb-package-catalog-add-wizard.js";

interface OperatorRow { operator_id: bigint | string | number }

// 검증된 Kakao identity를 하나의 active admin operator로 해석합니다.
async function resolveWizardOperator(database: DatabaseClient, externalUserId: string): Promise<string> {
  const operators = await database.query<OperatorRow[]>(
    `SELECT mapping.operator_id
     FROM external_identities identity
     JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
     JOIN admin_operators operator ON operator.id=mapping.operator_id
     WHERE identity.provider_code='kakao' AND identity.external_user_id=?
       AND identity.status='linked' AND operator.status='active'
     ORDER BY mapping.operator_id LIMIT 2`,
    [externalUserId],
  );
  if (operators.length !== 1) throw new PackageCatalogCommandError("FORBIDDEN", "패키지 관리 권한이 없습니다.");
  return operators[0]!.operator_id.toString();
}

// Iris 제어명령과 active-session 일반 입력을 패키지 추가 마법사로 전달합니다.
export class PackageCatalogAddWizardIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async hasActiveSession(event: NormalizedIrisEvent): Promise<boolean> {
    if (!event.userId) return false;
    try {
      const operatorId = await resolveWizardOperator(this.database, event.userId);
      return (await new MariaDbPackageCatalogAddWizardRepository(this.database).readActive(operatorId, new Date())) !== undefined;
    } catch (error) {
      if (error instanceof PackageCatalogCommandError && error.code === "FORBIDDEN") return false;
      throw error;
    }
  }

  public async execute(event: NormalizedIrisEvent): Promise<{ commandCode: string; message: string; replayed: boolean; outboxId?: string }> {
    if (!event.userId || !event.channelId || !event.message) {
      throw new PackageCatalogCommandError("PACKAGE_WIZARD_IDENTITY_REQUIRED", "관리자 식별 정보를 확인할 수 없습니다.");
    }
    const operatorId = await resolveWizardOperator(this.database, event.userId);
    const control = parsePackageCatalogWizardControl(event.message);
    const command = control ?? { kind: "FLOW" as const, text: event.message };
    const result = await new PackageCatalogAddWizardService(
      new MariaDbPackageCatalogAddWizardRepository(this.database, event.channelId),
    ).execute({ operatorId, requestKey: event.eventId, command });
    return { commandCode: `PACKAGE_CATALOG_WIZARD_${command.kind}`, message: result.message, replayed: result.replayed, outboxId: result.outboxId };
  }
}
