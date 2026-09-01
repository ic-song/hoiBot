export type BadgeLifecycleClass = "AWARD" | "DISPLAY";

export interface BadgeObjectCatalogDefinition {
  badgeCode: string;
  series: string;
  definitionVersion: 930000002;
  lifecycleClass: BadgeLifecycleClass;
  objectKey: string;
}

export class BadgeObjectCatalogReadModel {
  constructor(private readonly definitions: readonly BadgeObjectCatalogDefinition[]) {}

  list(): readonly BadgeObjectCatalogDefinition[] {
    return this.definitions;
  }

  find(badgeCode: string, series: string, definitionVersion: 930000002): BadgeObjectCatalogDefinition | null {
    return this.definitions.find(
      (definition) =>
        definition.badgeCode === badgeCode &&
        definition.series === series &&
        definition.definitionVersion === definitionVersion,
    ) ?? null;
  }
}
