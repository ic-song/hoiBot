-- WBS743: /펫타이틀판매 canonical PET_TITLE+CURRENCY settlement binding.
ALTER TABLE canonical_currency_operations
  ADD UNIQUE KEY IF NOT EXISTS uq_odbt_471_00_01 (currency_operation_id,player_id);

ALTER TABLE canonical_pet_title_operations
  ADD COLUMN IF NOT EXISTS currency_operation_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER owned_pet_id,
  ADD UNIQUE KEY IF NOT EXISTS uq_odbt_471_01_01 (currency_operation_id),
  ADD CONSTRAINT fk_odbt_471_01_01 FOREIGN KEY IF NOT EXISTS (currency_operation_id,player_id) REFERENCES canonical_currency_operations (currency_operation_id,player_id) ON DELETE RESTRICT;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('PET_TITLE_SELL','pet_title_lifecycle','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/펫타이틀판매 [번호]','PET_TITLE_SELL',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;
