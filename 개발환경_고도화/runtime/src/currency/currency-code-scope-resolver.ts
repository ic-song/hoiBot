export type CurrencyCodeResolutionInput =
  | { providerContext: "PLAYER_REWARD"; ownerScope: "PLAYER"; sourceCode: string }
  | { providerContext: "GUILD_REWARD"; ownerScope: "GUILD"; sourceCode: string }
  | { providerContext: "PACKAGE_POINT"; ownerScope: "PLAYER"; sourceCode: string; definitionCode: string };

// provider context와 owner scope가 확정된 legacy 코드만 canonical 통화 코드로 수렴합니다.
export function resolveCanonicalCurrencyCode(input: CurrencyCodeResolutionInput): string {
  switch (input.providerContext) {
    case "PLAYER_REWARD":
      return input.sourceCode === "POINT" ? "point" : input.sourceCode;
    case "GUILD_REWARD":
      return input.sourceCode === "POINT" ? "guild_fund" : input.sourceCode;
    case "PACKAGE_POINT":
      return input.definitionCode === "ITEM-RWD-011" || input.sourceCode === "ITEM-RWD-011"
        ? "point"
        : input.sourceCode;
  }
}
