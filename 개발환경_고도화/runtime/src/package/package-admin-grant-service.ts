import { createHash } from "node:crypto";
import {
  isPackageAdminGrantCommand,
  parsePackageAdminGrantCommand
} from "./package-admin-grant-policy.js";
import type {
  PackageAdminGrantCommand,
  PackageAdminGrantRepository,
  PackageAdminGrantStoredResult
} from "./package-admin-grant-repository.js";

export type PackageAdminGrantResult = PackageAdminGrantStoredResult
  | { status: "ignored_not_candidate" | "ignored_forbidden" }
  | { status: "invalid_count" | "package_not_found" | "package_name_invalid" | "package_disabled" | "target_not_found"; data: string };

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 권한 확인 뒤 parser·catalog·target·transaction 순으로 관리자 지급을 처리합니다.
export class PackageAdminGrantService {
  constructor(private readonly repository: PackageAdminGrantRepository) {}

  async handle(command: PackageAdminGrantCommand): Promise<PackageAdminGrantResult> {
    if (!isPackageAdminGrantCommand(command.message)) return { status: "ignored_not_candidate" };
    return this.repository.withTransaction(async (transaction) => {
      const operator = await transaction.findAuthorizedOperator(command.externalUserId);
      if (operator === null) return { status: "ignored_forbidden" };
      const parsed = parsePackageAdminGrantCommand(command.message);
      if (parsed.status !== "parsed") return parsed;
      const scope = `package.admin.grant:${operator.id}`;
      const key = eventKey(command.eventId);
      const stored = await transaction.findStoredResult(scope, key);
      if (stored !== null) return { ...stored, duplicate: true };
      return transaction.grant(operator, scope, key, command, parsed.value);
    });
  }
}
