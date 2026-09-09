import { resolveCanonicalCurrencyCode } from "../currency/currency-code-scope-resolver.js";

export type PackageDomainItemType =
  | "STACK"
  | "POINT"
  | "PET"
  | "MINI_PET"
  | "FURNITURE"
  | "MEMBER_TITLE"
  | "PET_TITLE"
  | "PET_APPEARANCE"
  | "GUILD_RESOURCE";

export interface PackageDomainItemDefinition {
  id: string;
  type: PackageDomainItemType;
  displayName: string;
  metadata: Record<string, unknown>;
}

export interface PackageDomainMutation {
  operationId: string;
  sequenceNo: number;
  playerId: string;
  quantity: number;
  targetId?: string;
  guildId?: string;
  reasonCode: string;
}

export interface PackageDomainSqlResult {
  affectedRows: bigint;
  insertId?: string | number | bigint;
}

export interface PackageDomainTransaction {
  query<T>(sql: string, parameters?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<PackageDomainSqlResult>;
}

interface IdRow {
  id: string;
}

interface BalanceRow {
  balance: string;
}

interface QuantityRow {
  quantity: string;
}

// 공용 ItemProvider가 위임한 현재 도메인 변경을 저장합니다.
export class PackageDomainItemMutationStore {
  public async add(
    transaction: PackageDomainTransaction,
    definition: PackageDomainItemDefinition,
    mutation: PackageDomainMutation,
  ): Promise<void> {
    this.assertQuantity(mutation.quantity);
    await this.mutate(transaction, definition, mutation, mutation.quantity);
  }

  public async remove(
    transaction: PackageDomainTransaction,
    definition: PackageDomainItemDefinition,
    mutation: PackageDomainMutation,
  ): Promise<void> {
    this.assertQuantity(mutation.quantity);
    const balance = await this.getBalance(transaction, definition, mutation);
    if (balance < mutation.quantity) {
      throw new Error("PACKAGE_ITEM_BALANCE_INSUFFICIENT");
    }
    await this.mutate(transaction, definition, mutation, -mutation.quantity);
  }

  public async has(
    transaction: PackageDomainTransaction,
    definition: PackageDomainItemDefinition,
    mutation: PackageDomainMutation,
  ): Promise<boolean> {
    this.assertQuantity(mutation.quantity);
    return (await this.getBalance(transaction, definition, mutation)) >= mutation.quantity;
  }

  public async getBalance(
    transaction: PackageDomainTransaction,
    definition: PackageDomainItemDefinition,
    mutation: PackageDomainMutation,
  ): Promise<number> {
    switch (definition.type) {
      case "STACK":
        return this.getStackBalance(transaction, definition.id, mutation.playerId);
      case "POINT":
        return this.getCurrencyBalance(transaction, this.packagePointCurrencyCode(definition), mutation.playerId);
      case "FURNITURE":
        return this.getOwnedDefinitionBalance(transaction, "owned_furniture", "furniture_definitions", "furniture_definition_id", definition.id, mutation.playerId);
      case "MINI_PET":
        return this.getOwnedInstanceBalance(transaction, "owned_mini_pets", "mini_pet_definitions", "mini_pet_definition_id", definition.id, mutation.playerId);
      case "MEMBER_TITLE":
        return this.getTitleBalance(transaction, definition.id, mutation.playerId, undefined);
      case "PET_TITLE":
        return this.getTitleBalance(transaction, definition.id, mutation.playerId, mutation.targetId);
      case "PET":
        return this.getPetBalance(transaction, definition.id, mutation.playerId);
      case "PET_APPEARANCE":
        return this.getPetAppearanceBalance(transaction, definition, mutation);
      case "GUILD_RESOURCE":
        return this.getGuildResourceBalance(transaction, definition, mutation);
      default:
        throw new Error("PACKAGE_ITEM_TYPE_UNSUPPORTED");
    }
  }

  // 아이템 유형별 실제 도메인 변경과 공통 효과 원장을 한 트랜잭션으로 기록
  private async mutate(
    transaction: PackageDomainTransaction,
    definition: PackageDomainItemDefinition,
    mutation: PackageDomainMutation,
    delta: number,
  ): Promise<void> {
    switch (definition.type) {
      case "STACK":
        await this.mutateStack(transaction, definition.id, mutation, delta);
        break;
      case "POINT":
        await this.mutateCurrency(transaction, this.packagePointCurrencyCode(definition), mutation, delta);
        break;
      case "FURNITURE":
        await this.mutateFurniture(transaction, definition.id, mutation, delta);
        break;
      case "MINI_PET":
        await this.mutateMiniPet(transaction, definition.id, mutation, delta);
        break;
      case "MEMBER_TITLE":
        await this.mutateTitle(transaction, definition.id, mutation, delta, false);
        break;
      case "PET_TITLE":
        await this.mutateTitle(transaction, definition.id, mutation, delta, true);
        break;
      case "PET":
        await this.mutatePet(transaction, definition, mutation, delta);
        break;
      case "PET_APPEARANCE":
        await this.mutatePetAppearance(transaction, definition, mutation, delta);
        break;
      case "GUILD_RESOURCE":
        await this.mutateGuildResource(transaction, definition, mutation, delta);
        break;
      default:
        throw new Error("PACKAGE_ITEM_TYPE_UNSUPPORTED");
    }

    await transaction.execute(
      `INSERT INTO package_item_effects
         (operation_id, sequence_no, player_id, package_item_id, item_type, target_id, quantity_delta, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mutation.operationId,
        mutation.sequenceNo,
        mutation.playerId,
        definition.id,
        definition.type,
        mutation.targetId ?? null,
        delta,
        JSON.stringify({ reasonCode: mutation.reasonCode, guildId: mutation.guildId ?? null }),
      ],
    );
  }

  // 수량형 가방 아이템 변경
  private async mutateStack(transaction: PackageDomainTransaction, code: string, mutation: PackageDomainMutation, delta: number): Promise<void> {
    const itemId = await this.requireDefinitionId(transaction, "item_definitions", code);
    await transaction.execute(
      `INSERT INTO inventory_stacks (player_id, item_id, quantity, version)
       VALUES (?, ?, GREATEST(?, 0), 1)
       ON DUPLICATE KEY UPDATE quantity = quantity + ?, version = version + 1`,
      [mutation.playerId, itemId, delta, delta],
    );
    await transaction.execute(
      `INSERT INTO inventory_ledger
         (operation_id, sequence_no, player_id, item_id, instance_id, quantity_delta, reason_code)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      [mutation.operationId, mutation.sequenceNo, mutation.playerId, itemId, delta, mutation.reasonCode],
    );
  }

  // 포인트 계정 변경
  private async mutateCurrency(transaction: PackageDomainTransaction, currencyCode: string, mutation: PackageDomainMutation, delta: number): Promise<void> {
    await transaction.execute(
      `INSERT INTO currency_accounts (player_id, currency_code, balance, version)
       VALUES (?, ?, GREATEST(?, 0), 1)
       ON DUPLICATE KEY UPDATE balance = balance + ?, version = version + 1`,
      [mutation.playerId, currencyCode, delta, delta],
    );
    const balance = await this.getCurrencyBalance(transaction, currencyCode, mutation.playerId);
    await transaction.execute(
      `INSERT INTO currency_ledger
         (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mutation.operationId, mutation.sequenceNo, mutation.playerId, currencyCode, delta, balance, mutation.reasonCode],
    );
  }

  // 가구 보유 수량 변경
  private async mutateFurniture(transaction: PackageDomainTransaction, code: string, mutation: PackageDomainMutation, delta: number): Promise<void> {
    const definitionId = await this.requireDefinitionId(transaction, "furniture_definitions", code);
    await transaction.execute(
      `INSERT INTO owned_furniture (player_id, furniture_definition_id, quantity)
       VALUES (?, ?, GREATEST(?, 0))
       ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
      [mutation.playerId, definitionId, delta, delta],
    );
  }

  // 미니펫 인스턴스 추가 또는 최신 인스턴스 회수
  private async mutateMiniPet(transaction: PackageDomainTransaction, code: string, mutation: PackageDomainMutation, delta: number): Promise<void> {
    const definitionId = await this.requireDefinitionId(transaction, "mini_pet_definitions", code);
    if (delta > 0) {
      for (let index = 0; index < delta; index += 1) {
        await transaction.execute(
          `INSERT INTO owned_mini_pets
             (player_id, mini_pet_definition_id, custom_name, progress, enhancement_level, battle_experience, castle_experience, raid_experience, equipped)
           VALUES (?, ?, NULL, 0, 0, 0, 0, 0, 0)`,
          [mutation.playerId, definitionId],
        );
      }
      return;
    }
    await transaction.execute(
      `DELETE FROM owned_mini_pets
       WHERE player_id = ? AND mini_pet_definition_id = ?
       ORDER BY id DESC LIMIT ?`,
      [mutation.playerId, definitionId, Math.abs(delta)],
    );
  }

  // 사용자 또는 펫 칭호 변경
  private async mutateTitle(transaction: PackageDomainTransaction, code: string, mutation: PackageDomainMutation, delta: number, petTitle: boolean): Promise<void> {
    const titleId = await this.requireDefinitionId(transaction, "title_definitions", code);
    if (petTitle) {
      const petId = mutation.targetId ?? await this.requirePlayerPetId(transaction, mutation.playerId);
      if (delta > 0) {
        await transaction.execute(
          `INSERT IGNORE INTO pet_titles (player_pet_id, title_id, acquired_at, equipped)
           VALUES (?, ?, CURRENT_TIMESTAMP(3), 0)`,
          [petId, titleId],
        );
      } else {
        await transaction.execute("DELETE FROM pet_titles WHERE player_pet_id = ? AND title_id = ?", [petId, titleId]);
      }
      return;
    }
    if (delta > 0) {
      await transaction.execute(
        `INSERT IGNORE INTO player_titles (player_id, title_id, acquired_at, equipped, display_order)
         SELECT ?, ?, CURRENT_TIMESTAMP(3), 0, COALESCE(MAX(display_order), 0) + 1
           FROM player_titles WHERE player_id = ?`,
        [mutation.playerId, titleId, mutation.playerId],
      );
    } else {
      await transaction.execute("DELETE FROM player_titles WHERE player_id = ? AND title_id = ?", [mutation.playerId, titleId]);
    }
  }

  // 대표 펫 생성 또는 제거
  private async mutatePet(transaction: PackageDomainTransaction, definition: PackageDomainItemDefinition, mutation: PackageDomainMutation, delta: number): Promise<void> {
    if (delta > 0) {
      const existing = await this.getPetBalance(transaction, definition.id, mutation.playerId);
      if (existing > 0) return;
      await transaction.execute(
        `INSERT INTO player_pets
           (player_id, display_name, pet_type_code, image_value, joined_on, personality_label, experience, enhancement_level, version)
         VALUES (?, ?, ?, ?, CURRENT_DATE(), ?, 0, 0, 1)`,
        [
          mutation.playerId,
          this.metadataString(definition, "petName", definition.displayName),
          definition.id,
          this.metadataString(definition, "imageValue", ""),
          this.metadataString(definition, "personalityLabel", ""),
        ],
      );
    } else {
      await transaction.execute("DELETE FROM player_pets WHERE player_id = ? AND pet_type_code = ?", [mutation.playerId, definition.id]);
    }
  }

  // 대표 펫 외형 적용 또는 해제
  private async mutatePetAppearance(transaction: PackageDomainTransaction, definition: PackageDomainItemDefinition, mutation: PackageDomainMutation, delta: number): Promise<void> {
    const petId = mutation.targetId ?? await this.requirePlayerPetId(transaction, mutation.playerId);
    const imageValue = delta > 0 ? this.metadataString(definition, "imageValue", definition.id) : "";
    await transaction.execute(
      "UPDATE player_pets SET image_value = ?, version = version + 1 WHERE id = ? AND player_id = ?",
      [imageValue, petId, mutation.playerId],
    );
  }

  // 길드 자원 계정 변경
  private async mutateGuildResource(transaction: PackageDomainTransaction, definition: PackageDomainItemDefinition, mutation: PackageDomainMutation, delta: number): Promise<void> {
    if (!mutation.guildId) throw new Error("PACKAGE_GUILD_TARGET_REQUIRED");
    const currencyCode = this.metadataString(definition, "currencyCode", definition.id);
    await transaction.execute(
      `INSERT INTO guild_resource_accounts (guild_id, currency_code, balance, version)
       VALUES (?, ?, GREATEST(?, 0), 1)
       ON DUPLICATE KEY UPDATE balance = balance + ?, version = version + 1`,
      [mutation.guildId, currencyCode, delta, delta],
    );
    const balance = await this.getGuildResourceBalance(transaction, definition, mutation);
    await transaction.execute(
      `INSERT INTO guild_resource_ledger
         (operation_id, sequence_no, guild_id, currency_code, delta, balance_after, reason_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mutation.operationId, mutation.sequenceNo, mutation.guildId, currencyCode, delta, balance, mutation.reasonCode],
    );
  }

  // 스택형 아이템 잔액 조회
  private async getStackBalance(transaction: PackageDomainTransaction, code: string, playerId: string): Promise<number> {
    const rows = await transaction.query<QuantityRow>(
      `SELECT inventory_stacks.quantity
       FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id = inventory_stacks.item_id
       WHERE inventory_stacks.player_id = ? AND item_definitions.code = ?`,
      [playerId, code],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  // 포인트 잔액 조회
  private async getCurrencyBalance(transaction: PackageDomainTransaction, currencyCode: string, playerId: string): Promise<number> {
    const rows = await transaction.query<BalanceRow>(
      "SELECT balance FROM currency_accounts WHERE player_id = ? AND currency_code = ?",
      [playerId, currencyCode],
    );
    return Number(rows[0]?.balance ?? 0);
  }

  // 코드 기반 보유 테이블 수량 조회
  private async getOwnedDefinitionBalance(
    transaction: PackageDomainTransaction,
    ownedTable: string,
    definitionTable: string,
    definitionColumn: string,
    code: string,
    playerId: string,
  ): Promise<number> {
    const rows = await transaction.query<QuantityRow>(
      `SELECT COALESCE(SUM(owned.quantity), COUNT(*)) AS quantity
       FROM ${ownedTable} owned
       JOIN ${definitionTable} definition_row ON definition_row.id = owned.${definitionColumn}
       WHERE owned.player_id = ? AND definition_row.code = ?`,
      [playerId, code],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  // 인스턴스 한 행을 한 개로 저장하는 보유 테이블 수량 조회
  private async getOwnedInstanceBalance(
    transaction: PackageDomainTransaction,
    ownedTable: string,
    definitionTable: string,
    definitionColumn: string,
    code: string,
    playerId: string,
  ): Promise<number> {
    const rows = await transaction.query<QuantityRow>(
      `SELECT COUNT(*) AS quantity
       FROM ${ownedTable} owned
       JOIN ${definitionTable} definition_row ON definition_row.id = owned.${definitionColumn}
       WHERE owned.player_id = ? AND definition_row.code = ?`,
      [playerId, code],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  // 사용자·펫 칭호 보유 여부 조회
  private async getTitleBalance(transaction: PackageDomainTransaction, code: string, playerId: string, targetId?: string): Promise<number> {
    if (targetId) {
      const rows = await transaction.query<QuantityRow>(
        `SELECT COUNT(*) AS quantity
         FROM pet_titles
         JOIN title_definitions ON title_definitions.id = pet_titles.title_id
         JOIN player_pets ON player_pets.id = pet_titles.player_pet_id
         WHERE player_pets.player_id = ? AND player_pets.id = ? AND title_definitions.code = ?`,
        [playerId, targetId, code],
      );
      return Number(rows[0]?.quantity ?? 0);
    }
    const rows = await transaction.query<QuantityRow>(
      `SELECT COUNT(*) AS quantity
       FROM player_titles
       JOIN title_definitions ON title_definitions.id = player_titles.title_id
       WHERE player_titles.player_id = ? AND title_definitions.code = ?`,
      [playerId, code],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  // 대표 펫 보유 여부 조회
  private async getPetBalance(transaction: PackageDomainTransaction, code: string, playerId: string): Promise<number> {
    const rows = await transaction.query<QuantityRow>(
      "SELECT COUNT(*) AS quantity FROM player_pets WHERE player_id = ? AND pet_type_code = ?",
      [playerId, code],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  // 대표 펫 외형 적용 여부 조회
  private async getPetAppearanceBalance(transaction: PackageDomainTransaction, definition: PackageDomainItemDefinition, mutation: PackageDomainMutation): Promise<number> {
    const imageValue = this.metadataString(definition, "imageValue", definition.id);
    const rows = await transaction.query<QuantityRow>(
      "SELECT COUNT(*) AS quantity FROM player_pets WHERE player_id = ? AND image_value = ?",
      [mutation.playerId, imageValue],
    );
    return Number(rows[0]?.quantity ?? 0);
  }

  // 길드 자원 잔액 조회
  private async getGuildResourceBalance(transaction: PackageDomainTransaction, definition: PackageDomainItemDefinition, mutation: PackageDomainMutation): Promise<number> {
    if (!mutation.guildId) return 0;
    const rows = await transaction.query<BalanceRow>(
      "SELECT balance FROM guild_resource_accounts WHERE guild_id = ? AND currency_code = ?",
      [mutation.guildId, this.metadataString(definition, "currencyCode", definition.id)],
    );
    return Number(rows[0]?.balance ?? 0);
  }

  // 코드로 활성 도메인 정의 ID 조회
  private async requireDefinitionId(transaction: PackageDomainTransaction, tableName: string, code: string): Promise<string> {
    const rows = await transaction.query<IdRow>(`SELECT id FROM ${tableName} WHERE code = ? AND active = 1`, [code]);
    if (!rows[0]) throw new Error("PACKAGE_DOMAIN_DEFINITION_NOT_FOUND");
    return String(rows[0].id);
  }

  // 사용자의 대표 펫 ID 조회
  private async requirePlayerPetId(transaction: PackageDomainTransaction, playerId: string): Promise<string> {
    const rows = await transaction.query<IdRow>("SELECT id FROM player_pets WHERE player_id = ? ORDER BY id LIMIT 1", [playerId]);
    if (!rows[0]) throw new Error("PACKAGE_PLAYER_PET_NOT_FOUND");
    return String(rows[0].id);
  }

  // metadata 문자열을 안전하게 읽고 기본값 적용
  private metadataString(definition: PackageDomainItemDefinition, key: string, fallback: string): string {
    const value = definition.metadata[key];
    return typeof value === "string" && value.length > 0 ? value : fallback;
  }

  // package POINT projection을 player 통화 계정의 canonical 코드로 제한해 해석합니다.
  private packagePointCurrencyCode(definition: PackageDomainItemDefinition): string {
    return resolveCanonicalCurrencyCode({
      providerContext: "PACKAGE_POINT",
      ownerScope: "PLAYER",
      sourceCode: this.metadataString(definition, "currencyCode", definition.id),
      definitionCode: definition.id,
    });
  }

  // 정수형 양수 수량 검증
  private assertQuantity(quantity: number): void {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("PACKAGE_ITEM_QUANTITY_INVALID");
    }
  }
}
