export type ItemType =
  | "STACK"
  | "POINT"
  | "PET"
  | "MINI_PET"
  | "FURNITURE"
  | "MEMBER_TITLE"
  | "PET_TITLE"
  | "PET_APPEARANCE"
  | "GUILD_RESOURCE";

export interface ItemDefinition {
  id: string;
  type: ItemType;
  name: string;
  stackable: boolean;
  metadata: Readonly<Record<string, unknown>>;
  enabled: boolean;
}

export interface ItemMutationContext {
  ownerType: "USER" | "PET" | "GUILD";
  ownerId: string;
  actorUserId?: string;
  transactionId: string;
  transactionHandle?: unknown;
  requestKey: string;
  operation?: "ADD" | "REMOVE" | "REPLACE";
  targetSelector?: string | null;
  metadataOverride?: Readonly<Record<string, unknown>> | null;
}

export interface ItemDefinitionRepository {
  findById(itemId: string, transactionHandle?: unknown): Promise<ItemDefinition | undefined>;
}

export interface ItemTypeHandler {
  checkAdd(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void>;
  checkRemove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void>;
  add(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void>;
  remove(definition: ItemDefinition, quantity: bigint, context: ItemMutationContext): Promise<void>;
}

// 모든 아이템 유형을 동일한 조회·추가·제거 계약으로 연결합니다.
export class ItemProvider {
  private readonly handlers = new Map<ItemType, ItemTypeHandler>();
  private readonly transactionDefinitions = new WeakMap<object, {
    transactionId: string;
    items: Map<string, [ItemDefinition, ItemTypeHandler]>;
  }>();

  constructor(private readonly definitions: ItemDefinitionRepository) {}

  register(type: ItemType, handler: ItemTypeHandler): void {
    if (this.handlers.has(type)) throw new Error(`ITEM_HANDLER_DUPLICATED:${type}`);
    this.handlers.set(type, handler);
  }

  async checkAdd(itemId: string, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const [definition, handler] = await this.resolve(itemId, quantity, context);
    await handler.checkAdd(definition, quantity, context);
  }

  async checkRemove(itemId: string, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const [definition, handler] = await this.resolve(itemId, quantity, context);
    await handler.checkRemove(definition, quantity, context);
  }

  async add(itemId: string, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const [definition, handler] = await this.resolve(itemId, quantity, context);
    await handler.add(definition, quantity, context);
  }

  async remove(itemId: string, quantity: bigint, context: ItemMutationContext): Promise<void> {
    const [definition, handler] = await this.resolve(itemId, quantity, context);
    await handler.remove(definition, quantity, context);
  }

  private async resolve(
    itemId: string,
    quantity: bigint,
    context: ItemMutationContext
  ): Promise<[ItemDefinition, ItemTypeHandler]> {
    if (quantity <= 0n) throw new Error("ITEM_QUANTITY_INVALID");
    const transactionHandle = context.transactionHandle;
    const cacheKey = transactionHandle !== null && (typeof transactionHandle === "object" || typeof transactionHandle === "function")
      ? transactionHandle as object
      : null;
    const transactionCache = cacheKey ? this.transactionDefinitions.get(cacheKey) : undefined;
    const cached = transactionCache?.transactionId === context.transactionId
      ? transactionCache.items.get(itemId)
      : undefined;
    if (cached) return cached;
    const definition = await this.definitions.findById(itemId, transactionHandle);
    if (!definition?.enabled) throw new Error(`ITEM_NOT_AVAILABLE:${itemId}`);
    const handler = this.handlers.get(definition.type);
    if (!handler) throw new Error(`ITEM_HANDLER_NOT_REGISTERED:${definition.type}`);
    const resolved: [ItemDefinition, ItemTypeHandler] = [definition, handler];
    if (cacheKey) {
      let cache = this.transactionDefinitions.get(cacheKey);
      if (!cache || cache.transactionId !== context.transactionId) {
        cache = { transactionId: context.transactionId, items: new Map<string, [ItemDefinition, ItemTypeHandler]>() };
        this.transactionDefinitions.set(cacheKey, cache);
      }
      cache.items.set(itemId, resolved);
    }
    return resolved;
  }
}
