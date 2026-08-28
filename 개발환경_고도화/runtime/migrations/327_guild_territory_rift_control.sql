CREATE TABLE IF NOT EXISTS guild_territory_rift_command_types (
  type_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_text VARCHAR(32) NOT NULL,
  item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adjustment_target VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adjustment_per_unit DECIMAL(10,3) NOT NULL,
  minimum_value DECIMAL(10,3) NOT NULL,
  maximum_value DECIMAL(10,3) NOT NULL,
  maximum_batch BIGINT UNSIGNED NOT NULL,
  count_argument_allowed BOOLEAN NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (type_code),
  UNIQUE KEY uq_guild_rift_command_text (command_text),
  UNIQUE KEY uq_guild_rift_item_code (item_code),
  CONSTRAINT fk_guild_rift_type_item FOREIGN KEY (item_code) REFERENCES item_definitions(code),
  CONSTRAINT ck_guild_rift_adjustment_target CHECK (adjustment_target IN ('instability_adjust','rift_bias')),
  CONSTRAINT ck_guild_rift_value_range CHECK (minimum_value<=maximum_value),
  CONSTRAINT ck_guild_rift_nonzero_adjustment CHECK (adjustment_per_unit<>0),
  CONSTRAINT ck_guild_rift_positive_batch CHECK (maximum_batch>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_territory_rift_authorizations (
  guild_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  authority_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  granted_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (guild_id,player_id,authority_code),
  CONSTRAINT fk_guild_rift_authorization_member FOREIGN KEY (guild_id,player_id) REFERENCES guild_members(guild_id,player_id) ON DELETE CASCADE,
  CONSTRAINT ck_guild_rift_authority CHECK (authority_code IN ('sword_master','combat_commander'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guild_territory_rift_command_uses (
  war_id BIGINT UNSIGNED NOT NULL,
  guild_id BIGINT UNSIGNED NOT NULL,
  command_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  requested_count BIGINT UNSIGNED NOT NULL,
  applied_count BIGINT UNSIGNED NOT NULL,
  before_value DECIMAL(10,3) NOT NULL,
  after_value DECIMAL(10,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (war_id,guild_id,command_type),
  UNIQUE KEY uq_guild_rift_use_operation (operation_id),
  CONSTRAINT fk_guild_rift_use_war FOREIGN KEY (war_id) REFERENCES guild_territory_wars(id) ON DELETE CASCADE,
  CONSTRAINT fk_guild_rift_use_guild FOREIGN KEY (guild_id) REFERENCES guilds(id),
  CONSTRAINT fk_guild_rift_use_type FOREIGN KEY (command_type) REFERENCES guild_territory_rift_command_types(type_code),
  CONSTRAINT fk_guild_rift_use_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_guild_rift_use_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_guild_rift_use_item FOREIGN KEY (item_id) REFERENCES item_definitions(id),
  CONSTRAINT ck_guild_rift_use_counts CHECK (requested_count>0 AND applied_count>0 AND applied_count<=requested_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
  ('guild_rift_guide','🌌 균열 유도권(/균열)','ITEM',TRUE,JSON_OBJECT('domain','guild_territory','command','/균열'),TRUE,1),
  ('guild_instability_up','🌪️ 전쟁불안정 증폭권(/불안정)','ITEM',TRUE,JSON_OBJECT('domain','guild_territory','command','/불안정'),TRUE,1),
  ('guild_instability_down','🚑 전쟁불안정 감소권(/안정)','ITEM',TRUE,JSON_OBJECT('domain','guild_territory','command','/안정'),TRUE,1),
  ('guild_great_rift_guide','🌋 대균열 유도권(/대균열)','ITEM',TRUE,JSON_OBJECT('domain','guild_territory','command','/대균열'),TRUE,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code=VALUES(asset_type_code),stackable=TRUE,metadata_json=VALUES(metadata_json),active=TRUE,version=version+1;
INSERT INTO guild_territory_rift_command_types(type_code,command_text,item_code,adjustment_target,adjustment_per_unit,minimum_value,maximum_value,maximum_batch,count_argument_allowed,active) VALUES
  ('rift_guide','/균열','guild_rift_guide','rift_bias',10.000,-70.000,30.000,100,TRUE,TRUE),
  ('instability_up','/불안정','guild_instability_up','instability_adjust',0.500,-10.000,10.000,100,TRUE,TRUE),
  ('instability_down','/안정','guild_instability_down','instability_adjust',-0.500,-10.000,10.000,100,TRUE,TRUE),
  ('great_rift_guide','/대균열','guild_great_rift_guide','rift_bias',-10.000,-70.000,30.000,1,FALSE,TRUE)
ON DUPLICATE KEY UPDATE command_text=VALUES(command_text),item_code=VALUES(item_code),adjustment_target=VALUES(adjustment_target),adjustment_per_unit=VALUES(adjustment_per_unit),minimum_value=VALUES(minimum_value),maximum_value=VALUES(maximum_value),maximum_batch=VALUES(maximum_batch),count_argument_allowed=VALUES(count_argument_allowed),active=TRUE;
INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version) VALUES ('GUILD_TERRITORY_RIFT_CONTROL','guild_territory_rift_control','VERIFIED_USER','SHADOW',TRUE,1) ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=TRUE,version=version+1;
INSERT INTO command_aliases(command_text,command_code,active) VALUES
  ('/균열','GUILD_TERRITORY_RIFT_CONTROL',TRUE),
  ('/불안정','GUILD_TERRITORY_RIFT_CONTROL',TRUE),
  ('/안정','GUILD_TERRITORY_RIFT_CONTROL',TRUE),
  ('/대균열','GUILD_TERRITORY_RIFT_CONTROL',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=TRUE;
COMMIT;
