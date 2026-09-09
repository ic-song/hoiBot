import type { DatabaseTransaction } from "../database.js";

export interface PlayerTitleOwnedProjection {
  instanceId: bigint | null;
  titleId: bigint;
  displayName: string;
  acquiredDisplay: string | null;
  acquisitionPrice: string;
  equipped: boolean;
  displayOrder: bigint;
}

// 코드형 instance를 우선하고 아직 instance가 없는 기존 보유 타이틀만 fallback으로 합칩니다.
export async function lockPlayerTitleOwnedProjection(transaction: DatabaseTransaction, playerId: bigint): Promise<PlayerTitleOwnedProjection[]> {
  const instances = await transaction.query<Array<{ instance_id: bigint; title_id: bigint; display_name: string; acquired_display: string | null; acquisition_price: string; equipped: number; display_order: bigint }>>(
    `SELECT instance_row.id instance_id,instance_row.title_id,
            COALESCE(instance_row.snapshot_name,definition.display_name) display_name,
            DATE_FORMAT(CONVERT_TZ(instance_row.acquired_at,'+00:00','+09:00'),'%Y-%m-%d %H:%i') acquired_display,
            CAST(instance_row.price_value AS CHAR) acquisition_price,instance_row.equipped,instance_row.display_order
       FROM player_title_instances instance_row
       JOIN title_definitions definition ON definition.id=instance_row.title_id
      WHERE instance_row.player_id=? AND instance_row.status='owned' AND definition.active=TRUE
      ORDER BY instance_row.display_order,instance_row.id FOR UPDATE`, [playerId]);
  const fallback = await transaction.query<Array<{ title_id: bigint; display_name: string; acquired_display: string | null; acquisition_price: string; equipped: number; display_order: bigint }>>(
    `SELECT owned.title_id,definition.display_name,
            DATE_FORMAT(CONVERT_TZ(owned.acquired_at,'+00:00','+09:00'),'%Y-%m-%d %H:%i') acquired_display,
            CAST(owned.acquisition_price AS CHAR) acquisition_price,owned.equipped,COALESCE(owned.display_order,0) display_order
       FROM player_titles owned JOIN title_definitions definition ON definition.id=owned.title_id
      WHERE owned.player_id=? AND definition.active=TRUE
        AND NOT EXISTS (SELECT 1 FROM player_title_instances instance_row
                         WHERE instance_row.player_id=owned.player_id AND instance_row.title_id=owned.title_id AND instance_row.status='owned')
      ORDER BY owned.display_order IS NULL,owned.display_order,owned.acquired_at IS NULL,owned.acquired_at,owned.title_id FOR UPDATE`, [playerId]);
  const result: PlayerTitleOwnedProjection[] = instances.map((row) => ({ instanceId: row.instance_id, titleId: row.title_id, displayName: row.display_name, acquiredDisplay: row.acquired_display, acquisitionPrice: row.acquisition_price, equipped: Boolean(row.equipped), displayOrder: row.display_order }));
  fallback.forEach((row) => result.push({ instanceId: null, titleId: row.title_id, displayName: row.display_name, acquiredDisplay: row.acquired_display, acquisitionPrice: row.acquisition_price, equipped: Boolean(row.equipped), displayOrder: row.display_order }));
  result.sort((left, right) => left.displayOrder === right.displayOrder ? (left.instanceId === null ? 1 : -1) : left.displayOrder < right.displayOrder ? -1 : 1);
  return result;
}

// instance 순서를 압축하고 기존 aggregate의 대표 순서를 같은 값으로 맞춥니다.
export async function compactPlayerTitleOwnedProjection(transaction: DatabaseTransaction, playerId: bigint): Promise<void> {
  const rows = await transaction.query<Array<{ id: bigint; title_id: bigint }>>("SELECT id,title_id FROM player_title_instances WHERE player_id=? AND status='owned' ORDER BY display_order,id FOR UPDATE", [playerId]);
  for (let index=0; index<rows.length; index+=1) await transaction.execute("UPDATE player_title_instances SET display_order=? WHERE id=?", [index+1,rows[index]!.id]);
  await transaction.execute(`UPDATE player_titles owned SET display_order=(SELECT MIN(instance_row.display_order) FROM player_title_instances instance_row WHERE instance_row.player_id=owned.player_id AND instance_row.title_id=owned.title_id AND instance_row.status='owned') WHERE owned.player_id=? AND EXISTS (SELECT 1 FROM player_title_instances instance_row WHERE instance_row.player_id=owned.player_id AND instance_row.title_id=owned.title_id AND instance_row.status='owned')`, [playerId]);
}
