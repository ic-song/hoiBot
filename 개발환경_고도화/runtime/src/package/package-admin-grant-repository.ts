import type { ParsedPackageAdminGrant } from "./package-admin-grant-policy.js";

export interface PackageAdminGrantCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface PackageAdminGrantStoredResult {
  status: "granted";
  operatorId: string;
  operatorName: string;
  playerId: string;
  targetName: string;
  packageCode: string;
  packageName: string;
  bagItemCode: string;
  catalogVersion: string;
  listNumber: string;
  count: string;
  quantityBefore: string;
  quantityAfter: string;
  data: string;
  outboxId: string;
  auditId: string;
  duplicate?: boolean;
}

export type PackageAdminGrantDomainResult = PackageAdminGrantStoredResult
  | { status: "package_not_found" | "package_name_invalid" | "package_disabled" | "target_not_found"; data: string };

export interface PackageAdminGrantTransaction {
  findAuthorizedOperator(externalUserId: string): Promise<{ id: string; name: string } | null>;
  findStoredResult(scope: string, key: string): Promise<PackageAdminGrantStoredResult | null>;
  grant(operator: { id: string; name: string }, scope: string, key: string,
    command: PackageAdminGrantCommand, parsed: ParsedPackageAdminGrant): Promise<PackageAdminGrantDomainResult>;
}

export interface PackageAdminGrantRepository {
  withTransaction<T>(work: (transaction: PackageAdminGrantTransaction) => Promise<T>): Promise<T>;
}
