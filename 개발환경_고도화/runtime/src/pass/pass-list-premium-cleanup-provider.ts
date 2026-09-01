import { randomUUID } from "node:crypto";
import type { DatabaseTransaction } from "../database.js";

type Policy = { badge_code: string; intimacy_per_skill_slot: bigint; base_skill_slot_limit: bigint; textbook_slot_bonus: bigint };
type Pet = { player_pet_id: bigint; intimacy_level: bigint; floor_area: bigint };
type Skill = { slot_no: number; skill_id: bigint };
type Placement = { id: bigint; owned_furniture_id: bigint; placement_key: string };

// migration196의 premium 회수 정책과 증거 테이블을 재사용해 만료 부수효과를 원자 처리합니다.
export class PassListPremiumCleanupProvider {
  public async cleanup(tx: DatabaseTransaction, input: { parentOperationId: bigint; operatorId: bigint; playerId: bigint; today: string }): Promise<void> {
    const pet = (await tx.query<Pet[]>(`SELECT pet.id player_pet_id,COALESCE(intimacy.intimacy_level,0) intimacy_level,COALESCE(home.floor_area,0) floor_area FROM player_pets pet LEFT JOIN player_pet_intimacy intimacy ON intimacy.player_pet_id=pet.id LEFT JOIN player_homes home ON home.player_id=pet.player_id WHERE pet.player_id=? FOR UPDATE`, [input.playerId]))[0];
    if (!pet) return;
    const policy = (await tx.query<Policy[]>("SELECT badge_code,intimacy_per_skill_slot,base_skill_slot_limit,textbook_slot_bonus FROM hope_premium_delete_policy WHERE policy_key='default' FOR UPDATE"))[0]!;
    const child = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'support.pass.list.premium.cleanup',?,'admin_operator',?,'pass_list','processing',UTC_TIMESTAMP(3))", [randomUUID(), `${input.parentOperationId}:${input.playerId}`, input.operatorId])).insertId;
    await tx.execute("INSERT INTO hope_premium_delete_operations(operation_id,operator_id,target_player_id,player_pet_id,locked_skill_count,removed_ticket_count,badge_revoked,released_furniture_count,created_at) VALUES (?,?,?,?,0,0,FALSE,0,UTC_TIMESTAMP(3))", [child, input.operatorId, input.playerId, pet.player_pet_id]);
    await tx.execute("UPDATE player_passes SET enabled=FALSE WHERE player_id=? AND LOWER(pass_code) LIKE '%premium%'", [input.playerId]);
    const textbook = BigInt(String((await tx.query<Array<{ quantity: bigint }>>("SELECT COALESCE(SUM(stack.quantity),0) quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.display_name LIKE '%펫스킬%교과서%'", [input.playerId]))[0]!.quantity));
    const intimacy = BigInt(String(pet.intimacy_level)), intimacyPerSlot = BigInt(String(policy.intimacy_per_skill_slot)), slotCap = BigInt(String(policy.base_skill_slot_limit));
    const intimacySlots = intimacyPerSlot === 0n ? 0n : intimacy / intimacyPerSlot;
    const skillLimit = Number(intimacySlots > slotCap ? slotCap : intimacySlots) + (textbook > 0n ? Number(policy.textbook_slot_bonus) : 0);
    const skills = await tx.query<Skill[]>("SELECT slot_no,skill_id FROM pet_skills WHERE player_pet_id=? AND equipped=TRUE AND premium_locked=FALSE ORDER BY slot_no", [pet.player_pet_id]);
    const locked = skills.slice(skillLimit);
    for (let index = 0; index < locked.length; index++) {
      const skill = locked[index]!;
      await tx.execute("UPDATE pet_skills SET premium_locked=TRUE WHERE player_pet_id=? AND slot_no=?", [pet.player_pet_id, skill.slot_no]);
      await tx.execute("INSERT INTO hope_premium_delete_skill_locks(operation_id,sequence_no,player_pet_id,slot_no,skill_id) VALUES (?,?,?,?,?)", [child, index + 1, pet.player_pet_id, skill.slot_no, skill.skill_id]);
    }
    const badge = (await tx.query<Array<{ owned: number }>>("SELECT owned FROM player_home_badges WHERE player_id=? AND badge_code=? FOR UPDATE", [input.playerId, policy.badge_code]))[0];
    const badgeRevoked = badge?.owned === 1;
    if (badge) await tx.execute("UPDATE player_home_badges SET owned=FALSE,equipped=FALSE,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND badge_code=?", [input.playerId, policy.badge_code]);
    await tx.execute("UPDATE player_home_badge_cubes SET equipped=FALSE WHERE player_id=? AND badge_code=?", [input.playerId, policy.badge_code]);
    const furnitureLimit = Number(BigInt(String(pet.floor_area))) + 1;
    const placements = await tx.query<Placement[]>("SELECT id,owned_furniture_id,placement_key FROM furniture_placements WHERE player_id=? ORDER BY id FOR UPDATE", [input.playerId]);
    const released = placements.slice(furnitureLimit);
    for (let index = 0; index < released.length; index++) {
      const placement = released[index]!;
      await tx.execute("INSERT INTO hope_premium_delete_furniture_releases(operation_id,sequence_no,placement_id,owned_furniture_id,placement_key) VALUES (?,?,?,?,?)", [child, index + 1, placement.id, placement.owned_furniture_id, placement.placement_key]);
      await tx.execute("DELETE FROM furniture_placements WHERE id=?", [placement.id]);
    }
    const activeLegacy = (await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_passes WHERE player_id=? AND enabled=TRUE AND (permanent=TRUE OR ends_at IS NULL OR DATE(ends_at)>=?) AND (LOWER(pass_code) LIKE '%newbie%' OR LOWER(pass_code) LIKE '%hoi%' OR LOWER(pass_code) LIKE '%premium%' OR LOWER(pass_code)='support')", [input.playerId, input.today]))[0]!.count_value;
    const activeVersioned = (await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_support_passes WHERE player_id=? AND status='active' AND (entitlement_kind='permanent' OR end_date>=?) AND pass_code IN ('newbie','hoi','premium')", [input.playerId, input.today]))[0]!.count_value;
    let removedTicket = 0n;
    if (activeLegacy + activeVersioned === 0n) {
      const ticket = (await tx.query<Array<{ item_id: bigint; quantity: bigint }>>("SELECT stack.item_id,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.display_name='자동탐험권🌄' FOR UPDATE", [input.playerId]))[0];
      if (ticket && ticket.quantity > 0n) { removedTicket = ticket.quantity; await tx.execute("UPDATE inventory_stacks SET quantity=0,version=version+1 WHERE player_id=? AND item_id=?", [input.playerId, ticket.item_id]); await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code,created_at) VALUES (?,1,?,?,NULL,?,'premium_pass_expired',UTC_TIMESTAMP(3))", [child, input.playerId, ticket.item_id, -ticket.quantity]); }
    }
    await tx.execute("UPDATE hope_premium_delete_operations SET locked_skill_count=?,removed_ticket_count=?,badge_revoked=?,released_furniture_count=? WHERE operation_id=?", [locked.length, removedTicket, badgeRevoked, released.length, child]);
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify({ parentOperationId: input.parentOperationId.toString(), playerId: input.playerId.toString(), lockedSkillCount: locked.length, removedTicketCount: removedTicket.toString(), badgeRevoked, releasedFurnitureCount: released.length }), child]);
  }
}
