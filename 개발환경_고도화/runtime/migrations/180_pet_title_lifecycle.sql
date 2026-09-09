START TRANSACTION;

INSERT INTO player_pet_title_instances
  (instance_key,player_id,title_key,display_name,price_digits,display_order,acquired_at,equipped,status,version)
SELECT UUID(),legacy.player_id,legacy.code,legacy.display_name,'0',legacy.display_order,
       COALESCE(legacy.acquired_at,UTC_TIMESTAMP(3)),legacy.equipped,'owned',1
FROM (
  SELECT pet.player_id,definition.code,definition.display_name,assignment.acquired_at,assignment.equipped,
         ROW_NUMBER() OVER (PARTITION BY pet.player_id ORDER BY assignment.acquired_at,assignment.title_id) AS display_order
    FROM pet_titles assignment
    JOIN player_pets pet ON pet.id=assignment.player_pet_id
    JOIN title_definitions definition ON definition.id=assignment.title_id
) legacy
WHERE NOT EXISTS (SELECT 1 FROM player_pet_title_instances existing WHERE existing.player_id=legacy.player_id);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES
  ('PET_TITLE_SELECT','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1),
  ('PET_TITLE_LIST_SELF','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1),
  ('PET_TITLE_LIST_TARGET','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1),
  ('PET_TITLE_NAME_CREATE','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1),
  ('ADMIN_PET_TITLE_REMOVE','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/펫타이틀 [번호]','PET_TITLE_SELECT',1),
  ('/펫타이틀목록','PET_TITLE_LIST_SELF',1),
  ('/펫타이틀목록 [유저명]','PET_TITLE_LIST_TARGET',1),
  ('/펫타이틀이름 [인자]','PET_TITLE_NAME_CREATE',1),
  ('/펫타이틀제거 [유저명] [타이틀번호]','ADMIN_PET_TITLE_REMOVE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
