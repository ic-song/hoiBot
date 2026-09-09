import {
  PackageCatalogCommandError,
  type PackageCatalogAdminCommand,
  type PackageCatalogRewardInput,
} from "./package-catalog-admin-command.js";

export interface PackageCatalogProjectionEntry {
  packageId: string;
  displayName: string;
  displayOrder: number;
  active: boolean;
  rowVersion: bigint;
}

export interface PackageCatalogSnapshot {
  catalogVersion: bigint;
  entries: readonly PackageCatalogProjectionEntry[];
}

export type PackageCatalogMutation =
  | { action: "ADD"; displayName: string; description: string; rewards: readonly PackageCatalogRewardInput[]; displayOrder: number }
  | { action: "EDIT"; packageId: string; rewards: readonly PackageCatalogRewardInput[] }
  | { action: "REMOVE"; packageId: string; alias: string }
  | { action: "ENABLE"; packageId: string };

export interface PackageCatalogMutationRequest {
  requestKey: string;
  actorOperatorId: string;
  permissionCode: "package.catalog.manage";
  expectedCatalogVersion: bigint;
  commandCode: "PACKAGE_CATALOG_ADD" | "PACKAGE_CATALOG_EDIT" | "PACKAGE_CATALOG_REMOVE" | "PACKAGE_CATALOG_ENABLE";
  replyDestinationId?: string;
  mutation: PackageCatalogMutation;
}

export interface PackageCatalogMutationResult {
  replayed: boolean;
  catalogVersion: bigint;
  packageId: string;
  message: string;
  outboxId?: string;
}

export interface PackageCatalogAdminRepository {
  findReplay?(requestKey: string): Promise<PackageCatalogMutationResult | undefined>;
  readSnapshot(): Promise<PackageCatalogSnapshot>;
  mutate(request: PackageCatalogMutationRequest): Promise<PackageCatalogMutationResult>;
}

// 현재 compact 표시 번호를 stable package ID로 해석합니다.
function resolveEntry(snapshot: PackageCatalogSnapshot, listNumber: number): PackageCatalogProjectionEntry {
  if (!Number.isSafeInteger(listNumber) || listNumber < 1 || listNumber > snapshot.entries.length) {
    throw new PackageCatalogCommandError("PACKAGE_NUMBER_INVALID", "패키지 번호를 확인해 주세요.");
  }
  return snapshot.entries[listNumber - 1]!;
}

export class PackageCatalogAdminService {
  public constructor(private readonly repository: PackageCatalogAdminRepository) {}

  // 파싱된 관리자 명령을 versioned repository mutation으로 실행합니다.
  public async execute(input: {
    command: PackageCatalogAdminCommand;
    requestKey: string;
    actorOperatorId: string;
    expectedCatalogVersion?: bigint;
    replyDestinationId?: string;
  }): Promise<PackageCatalogMutationResult> {
    const replay = await this.repository.findReplay?.(input.requestKey);
    if (replay) return replay;
    const snapshot = await this.repository.readSnapshot();
    const expectedCatalogVersion = input.expectedCatalogVersion ?? snapshot.catalogVersion;
    const command = input.command;
    let mutation: PackageCatalogMutation;
    if (command.kind === "ADD") {
      if (snapshot.entries.some((entry) => entry.displayName === command.displayName)) {
        throw new PackageCatalogCommandError("PACKAGE_NAME_DUPLICATE", "같은 이름의 패키지가 이미 있습니다.");
      }
      mutation = {
        action: "ADD",
        displayName: command.displayName,
        description: command.description,
        rewards: command.rewards,
        displayOrder: snapshot.entries.length + 1,
      };
    } else {
      const entry = resolveEntry(snapshot, command.listNumber);
      if (command.kind === "EDIT") mutation = { action: "EDIT", packageId: entry.packageId, rewards: command.rewards };
      else if (command.kind === "REMOVE") mutation = { action: "REMOVE", packageId: entry.packageId, alias: command.alias };
      else mutation = { action: "ENABLE", packageId: entry.packageId };
    }
    return this.repository.mutate({
      requestKey: input.requestKey,
      actorOperatorId: input.actorOperatorId,
      permissionCode: "package.catalog.manage",
      expectedCatalogVersion,
      commandCode: `PACKAGE_CATALOG_${command.kind}`,
      replyDestinationId: input.replyDestinationId,
      mutation,
    });
  }
}
