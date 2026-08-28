START TRANSACTION;

ALTER TABLE player_title_instances
  ADD COLUMN IF NOT EXISTS snapshot_name VARCHAR(191) NULL AFTER title_id,
  ADD COLUMN IF NOT EXISTS legacy_price_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER price_value,
  ADD CONSTRAINT IF NOT EXISTS ck_player_title_instance_legacy_price_json CHECK (legacy_price_json IS NULL OR JSON_VALID(legacy_price_json));

UPDATE player_title_instances instance_row
JOIN title_definitions definition ON definition.id=instance_row.title_id
SET instance_row.snapshot_name=definition.display_name,
    instance_row.legacy_price_json=CAST(instance_row.price_value AS CHAR)
WHERE instance_row.snapshot_name IS NULL OR instance_row.legacy_price_json IS NULL;

INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,result_json,created_at,completed_at)
SELECT UUID(),'migration.title_instance.backfill',CONCAT(title_row.player_id,':',title_row.title_id),'system',NULL,'migration_313','completed','{}',COALESCE(title_row.acquired_at,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3)
FROM player_titles title_row
WHERE NOT EXISTS (
  SELECT 1 FROM player_title_instances instance_row
  WHERE instance_row.player_id=title_row.player_id AND instance_row.title_id=title_row.title_id AND instance_row.status='owned'
);

INSERT INTO player_title_instances(instance_key,player_id,title_id,snapshot_name,source_operation_id,source_sequence_no,price_value,legacy_price_json,display_order,status,equipped,acquired_at,version)
SELECT UUID(),candidate.player_id,candidate.title_id,candidate.display_name,candidate.operation_id,1,candidate.acquisition_price,CAST(candidate.acquisition_price AS CHAR),candidate.max_order + candidate.row_no,'owned',candidate.equipped,COALESCE(candidate.acquired_at,UTC_TIMESTAMP(3)),1
FROM (
  SELECT title_row.player_id,title_row.title_id,definition.display_name,operation_row.id AS operation_id,title_row.acquisition_price,title_row.equipped,title_row.acquired_at,
         COALESCE((SELECT MAX(existing_row.display_order) FROM player_title_instances existing_row WHERE existing_row.player_id=title_row.player_id),0) AS max_order,
         ROW_NUMBER() OVER (PARTITION BY title_row.player_id ORDER BY COALESCE(title_row.display_order,18446744073709551615),title_row.title_id) AS row_no
  FROM player_titles title_row
  JOIN title_definitions definition ON definition.id=title_row.title_id
  JOIN operations operation_row ON operation_row.idempotency_scope='migration.title_instance.backfill' AND operation_row.idempotency_key=CONCAT(title_row.player_id,':',title_row.title_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM player_title_instances instance_row
    WHERE instance_row.player_id=title_row.player_id AND instance_row.title_id=title_row.title_id AND instance_row.status='owned'
  )
) candidate;

INSERT INTO admin_permissions(code,display_name)
VALUES('player.title.change','회원 타이틀 지급·추가·제거')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'player.title.change' FROM admin_roles WHERE code IN('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
 ('ADMIN_MEMBER_TITLE_ADD','admin_title_gift_ticket_grant','VERIFIED_USER','SHADOW',TRUE,1),
 ('ADMIN_MEMBER_TITLE_GRANT','admin_title_gift_ticket_grant','VERIFIED_USER','SHADOW',TRUE,1),
 ('ADMIN_MEMBER_TITLE_REMOVE','admin_title_gift_ticket_grant','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active) VALUES
 ('/타이틀추가','ADMIN_MEMBER_TITLE_ADD',TRUE),
 ('/타이틀지급','ADMIN_MEMBER_TITLE_GRANT',TRUE),
 ('/타이틀제거','ADMIN_MEMBER_TITLE_REMOVE',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;

COMMIT;
