import {
  formatPackageCommandError,
  formatPackageUseHelp,
  parsePackageCommand,
} from "./package-command.js";

export interface PackageBagEntry {
  bagNumber: number;
  packageId: string;
  displayName: string;
  quantity: number;
  maxOpenCount: number;
}

export interface PackageUseRequest {
  requestKey: string;
  playerId: string;
  packageId: string;
  openCount: number;
}

export interface PackageUseResult {
  replayed: boolean;
  packageId: string;
  displayName: string;
  openCount: number;
  rewards: Array<{ displayName: string; quantity: number }>;
}

export interface PackageHubApplicationPort {
  listBag(playerId: string): Promise<PackageBagEntry[]>;
  use(request: PackageUseRequest): Promise<PackageUseResult>;
}

export interface PackageCommandRequest {
  message: string;
  playerId: string;
  requestKey: string;
}

export interface PackageCommandResponse {
  commandCode: "PACKAGE_BAG" | "PACKAGE_USE";
  message: string;
  replayed: boolean;
}

// 패키지 명령을 가방 조회 또는 원자적 사용 요청으로 변환하는 애플리케이션 서비스
export class PackageCommandService {
  public constructor(private readonly packageHub: PackageHubApplicationPort) {}

  public async execute(request: PackageCommandRequest): Promise<PackageCommandResponse> {
    const input = parsePackageCommand(request.message);
    if (input.kind === "INVALID") {
      return { commandCode: "PACKAGE_USE", message: formatPackageCommandError(input), replayed: false };
    }
    if (input.kind === "PACKAGE_USE_HELP") {
      return { commandCode: "PACKAGE_USE", message: formatPackageUseHelp(), replayed: false };
    }

    const bag = await this.packageHub.listBag(request.playerId);
    if (input.kind === "PACKAGE_BAG") {
      return { commandCode: "PACKAGE_BAG", message: this.formatBag(bag), replayed: false };
    }

    const selected = bag.find((entry) => entry.bagNumber === input.bagNumber);
    if (!selected) {
      return {
        commandCode: "PACKAGE_USE",
        message: `패키지가방 ${input.bagNumber}번을 찾을 수 없어요. /패키지가방에서 번호를 다시 확인해 주세요.`,
        replayed: false,
      };
    }
    if (input.openCount > selected.maxOpenCount) {
      return {
        commandCode: "PACKAGE_USE",
        message: `${selected.displayName}은(는) 한 번에 최대 ${selected.maxOpenCount}개까지 사용할 수 있어요.`,
        replayed: false,
      };
    }
    if (input.openCount > selected.quantity) {
      return {
        commandCode: "PACKAGE_USE",
        message: `${selected.displayName} 보유 수량이 부족해요. 현재 ${selected.quantity}개를 가지고 있어요.`,
        replayed: false,
      };
    }

    const result = await this.packageHub.use({
      requestKey: request.requestKey,
      playerId: request.playerId,
      packageId: selected.packageId,
      openCount: input.openCount,
    });
    return {
      commandCode: "PACKAGE_USE",
      message: this.formatUseResult(result),
      replayed: result.replayed,
    };
  }

  // 패키지 가방 목록 문구 생성
  private formatBag(entries: PackageBagEntry[]): string {
    if (entries.length === 0) return "📦 보유한 패키지가 없어요.";
    const lines = entries.map((entry) => `${entry.bagNumber}. ${entry.displayName} ${entry.quantity}개`);
    return ["📦 패키지가방", "", ...lines, "", "사용: /패키지사용 [가방번호] [오픈갯수]"].join("\n");
  }

  // 패키지 사용 결과 문구 생성
  private formatUseResult(result: PackageUseResult): string {
    const rewards = result.rewards.length === 0
      ? ["지급된 보상이 없어요."]
      : result.rewards.map((reward) => `- ${reward.displayName} ${reward.quantity}개`);
    const replayNotice = result.replayed ? "\n이미 처리된 요청의 결과를 다시 보여드려요." : "";
    return [
      `📦 ${result.displayName} ${result.openCount}개를 사용했어요.`,
      "",
      ...rewards,
    ].join("\n") + replayNotice;
  }
}
