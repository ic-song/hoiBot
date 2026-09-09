export type CurrencyOwnerScope = "PLAYER" | "GUILD";

export interface CurrencyObjectCatalogDefinition {
  code: string;
  displayName: string;
  scaleDigits: number;
  ownerScope: CurrencyOwnerScope;
  definitionVersion: 1;
  objectKey: string;
}

export class CurrencyObjectCatalogReadModel {
  constructor(private readonly definitions: readonly CurrencyObjectCatalogDefinition[]) {}

  list(): readonly CurrencyObjectCatalogDefinition[] {
    return this.definitions;
  }

  find(code: string, ownerScope: CurrencyOwnerScope, definitionVersion: 1): CurrencyObjectCatalogDefinition | null {
    return this.definitions.find(
      (definition) =>
        definition.code === code &&
        definition.ownerScope === ownerScope &&
        definition.definitionVersion === definitionVersion,
    ) ?? null;
  }
}
