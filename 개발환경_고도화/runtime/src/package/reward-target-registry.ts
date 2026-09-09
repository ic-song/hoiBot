import type {
  ItemDefinition,
  ItemMutationContext,
  ItemMutationTargetRegistry,
  ItemType,
} from "./item-provider.js";

const OWNER_BY_TYPE: Readonly<Record<ItemType, ItemMutationContext["ownerType"]>> = {
  STACK: "USER",
  POINT: "USER",
  PET: "USER",
  MINI_PET: "USER",
  FURNITURE: "USER",
  MEMBER_TITLE: "USER",
  PET_TITLE: "PET",
  PET_APPEARANCE: "PET",
  GUILD_RESOURCE: "GUILD",
};

// 패키지 보상 유형을 canonical 도메인 소유자와 대상 규칙에 연결합니다.
export class PackageRewardTargetRegistry implements ItemMutationTargetRegistry {
  assertTarget(definition: ItemDefinition, context: ItemMutationContext): void {
    const expectedOwner = OWNER_BY_TYPE[definition.type];
    if (context.ownerType !== expectedOwner) {
      throw new Error(`PACKAGE_REWARD_OWNER_INVALID:${definition.type}:${expectedOwner}`);
    }
    if (expectedOwner === "PET" && (!context.targetSelector || context.ownerId !== context.targetSelector)) {
      throw new Error(`PACKAGE_REWARD_TARGET_REQUIRED:${definition.type}`);
    }
    if (definition.type === "PET_APPEARANCE" && context.operation !== "REPLACE") {
      throw new Error("PACKAGE_REWARD_REPLACE_REQUIRED:PET_APPEARANCE");
    }
  }
}
