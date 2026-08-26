START TRANSACTION;

INSERT INTO pet_definitions(code,display_name,metadata_json,active)
VALUES
  ('legacy-egg','알',JSON_OBJECT('legacyCode','알','normalEmojis',JSON_ARRAY('🪺'),'uniqueEmojis',JSON_ARRAY(),'evolutionRequiredExp',10),TRUE),
  ('legacy-sky','하늘',JSON_OBJECT('legacyCode','하늘','normalEmojis',JSON_ARRAY('🦃','🐓','🐥','🐦','🕊','🦅','🦆','🦢','🦉','🦤','🦩','🦚','🦜','🐦‍⬛','🦋','🐝','🐤','🦇'),'uniqueEmojis',JSON_ARRAY('🧚‍♂️','🧚‍♀️','🧚','🐉'),'evolutionRequiredExp',10),TRUE),
  ('legacy-land','땅',JSON_OBJECT('legacyCode','땅','normalEmojis',JSON_ARRAY('🦧','🐕','🐩','🐈','🐈‍⬛','🫏','🦌','🦬','🐄','🐖','🐏','🦛','🐀','🐇','🐿','🦔','🦥','🦦','🦨','🦘','🐍','🐆','🦓'),'uniqueEmojis',JSON_ARRAY('🧟‍♂️','🧟‍♀️','🧟','🦄','🦖','🐅'),'evolutionRequiredExp',10),TRUE),
  ('legacy-sea','바다',JSON_OBJECT('legacyCode','바다','normalEmojis',JSON_ARRAY('🐧','🐢','🐊','🐋','🐬','🦭','🐟','🐠','🐡','🦈','🐙','🦀','🦞','🦐','🦑','🪼'),'uniqueEmojis',JSON_ARRAY('🧜‍♂️','🧜‍♀️','🧜','🐳'),'evolutionRequiredExp',10),TRUE)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),metadata_json=VALUES(metadata_json),active=VALUES(active);

INSERT INTO admin_permissions(code,display_name)
VALUES('pet.charm.set','펫 매력 절대값 변경')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'pet.charm.set' FROM admin_roles WHERE code='super_admin'
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('ADMIN_PET_CHARM_SET','admin_pet_charm_set','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),
  rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/매력','ADMIN_PET_CHARM_SET',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
