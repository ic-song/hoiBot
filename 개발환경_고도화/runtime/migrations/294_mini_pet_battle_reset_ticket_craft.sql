START TRANSACTION;

INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
  ('legacy-seasoned-chicken','양념치킨🐔','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','양념치킨🐔'),TRUE,1),
  ('legacy-mini-pet-record-reset-ticket','미니펫전적초기화권0️⃣(/미니펫전적초기화)','ITEM',TRUE,JSON_OBJECT('source','legacy-main.js','legacyExactName','미니펫전적초기화권0️⃣(/미니펫전적초기화)','gate8Snapshot','pending'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;

CREATE TABLE mini_pet_battle_reset_ticket_craft_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  material_item_id BIGINT UNSIGNED NOT NULL,
  ticket_item_id BIGINT UNSIGNED NOT NULL,
  material_quantity BIGINT UNSIGNED NOT NULL,
  ticket_quantity BIGINT UNSIGNED NOT NULL,
  recipe_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY(operation_id),
  CONSTRAINT fk_mini_pet_record_ticket_craft_operation FOREIGN KEY(operation_id) REFERENCES operations(id),
  CONSTRAINT fk_mini_pet_record_ticket_craft_player FOREIGN KEY(player_id) REFERENCES players(id),
  CONSTRAINT fk_mini_pet_record_ticket_craft_material FOREIGN KEY(material_item_id) REFERENCES item_definitions(id),
  CONSTRAINT fk_mini_pet_record_ticket_craft_ticket FOREIGN KEY(ticket_item_id) REFERENCES item_definitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_BATTLE_RESET_TICKET_CRAFT','mini_pet_battle_reset_ticket_craft','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state='SHADOW',enabled=1,version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫전적조합','MINI_PET_BATTLE_RESET_TICKET_CRAFT',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=1;

COMMIT;
