CREATE TABLE common_code_groups (
  group_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(191) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (group_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE common_codes (
  group_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json JSON NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (group_code, code),
  CONSTRAINT fk_common_codes_group FOREIGN KEY (group_code) REFERENCES common_code_groups (group_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_servers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_game_servers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_server_mappings (
  channel_id BIGINT UNSIGNED NOT NULL,
  game_server_id BIGINT UNSIGNED NOT NULL,
  effective_at DATETIME(3) NOT NULL,
  PRIMARY KEY (channel_id),
  CONSTRAINT fk_channel_server_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  CONSTRAINT fk_channel_server_server FOREIGN KEY (game_server_id) REFERENCES game_servers (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE configuration_sets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  set_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  effective_from DATETIME(3) NULL,
  effective_to DATETIME(3) NULL,
  approved_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_configuration_set_version (set_code, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE configuration_values (
  configuration_set_id BIGINT UNSIGNED NOT NULL,
  config_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  value_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  string_value TEXT NULL,
  decimal_value DECIMAL(30,3) NULL,
  integer_value BIGINT NULL,
  boolean_value BOOLEAN NULL,
  json_value JSON NULL,
  validation_json JSON NULL,
  PRIMARY KEY (configuration_set_id, config_key),
  CONSTRAINT fk_configuration_values_set FOREIGN KEY (configuration_set_id) REFERENCES configuration_sets (id) ON DELETE CASCADE,
  CONSTRAINT chk_configuration_one_value CHECK (
    (string_value IS NOT NULL) + (decimal_value IS NOT NULL) + (integer_value IS NOT NULL) +
    (boolean_value IS NOT NULL) + (json_value IS NOT NULL) = 1
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE configuration_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  configuration_set_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  change_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_configuration_change_set FOREIGN KEY (configuration_set_id) REFERENCES configuration_sets (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
