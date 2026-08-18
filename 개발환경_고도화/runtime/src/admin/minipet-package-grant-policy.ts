export interface MinipetPackageGrantDefinition {
  command: "/창세패키지" | "/창조패키지";
  commandCode: "admin_minipet_genesis_package_grant" | "admin_minipet_creation_package_grant";
  itemCode: "bag_b2fd551a03f6fe6e" | "bag_11319869697c3c00";
  itemName: string;
}

export interface ParsedMinipetPackageGrant {
  definition: MinipetPackageGrantDefinition;
  amount: bigint;
  targetName: string;
}

export type MinipetPackageGrantParseResult =
  | { status: "parsed"; value: ParsedMinipetPackageGrant }
  | { status: "invalid_format"; data: string }
  | { status: "invalid_amount"; data: string };

export const MINIPET_PACKAGE_GRANTS: readonly MinipetPackageGrantDefinition[] = [
  {
    command: "/창세패키지", commandCode: "admin_minipet_genesis_package_grant",
    itemCode: "bag_b2fd551a03f6fe6e", itemName: "컬렉션창세패키지🐹(/컬렉션창세오픈)"
  },
  {
    command: "/창조패키지", commandCode: "admin_minipet_creation_package_grant",
    itemCode: "bag_11319869697c3c00", itemName: "컬렉션창조패키지🐹(/컬렉션창조오픈)"
  }
] as const;

const formatError = "올바른 형식으로 입력해 주세요. 예: /시련10, 유저아이디";
const amountError = "지급 개수는 1개 이상이어야 합니다.";

export function isMinipetPackageGrantCandidate(rawMessage: string | undefined): boolean {
  if (rawMessage === undefined) return false;
  const trimmed = rawMessage.trim();
  return MINIPET_PACKAGE_GRANTS.some(({ command }) =>
    trimmed.startsWith(`${command},`) || new RegExp(`^${command}\\d*,`).test(trimmed));
}

export function parseMinipetPackageGrant(rawMessage: string): MinipetPackageGrantParseResult {
  const definition = MINIPET_PACKAGE_GRANTS.find(({ command }) => rawMessage.trim().startsWith(command));
  if (definition === undefined) return { status: "invalid_format", data: formatError };
  const escaped = definition.command.replace("/", "\\/");
  const match = new RegExp(`^${escaped}(\\d*)?,\\s*(.+)$`).exec(rawMessage);
  if (match === null) return { status: "invalid_format", data: formatError };
  const amount = match[1] === "" || match[1] === undefined ? 1n : BigInt(match[1]);
  if (amount <= 0n) return { status: "invalid_amount", data: amountError };
  return { status: "parsed", value: { definition, amount, targetName: match[2]!.trim() } };
}

export function buildMinipetPackageGrantReply(targetName: string, itemName: string, amount: bigint): string {
  return `${targetName}님에게 ${itemName} ${amount}개를 지급했습니다.`;
}

export const MINIPET_PACKAGE_TARGET_REQUIRED = "유저 아이디를 확인해 주세요.";
