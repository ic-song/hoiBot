CREATE TABLE IF NOT EXISTS pet_home_badge_definitions (
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  badge_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  emoji VARCHAR(32) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (badge_code),
  UNIQUE KEY uq_pet_home_badge_category_name (badge_category, display_name),
  CONSTRAINT chk_pet_home_badge_category CHECK (badge_category IN ('special','activity','gacha'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_badge_equipment (
  player_id BIGINT UNSIGNED NOT NULL,
  equipped_badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (player_id),
  CONSTRAINT fk_player_badge_equipment_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_badge_alerts (
  alert_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  alert_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_operator_id BIGINT UNSIGNED NOT NULL,
  source_operation_id BIGINT UNSIGNED NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (alert_id),
  UNIQUE KEY uq_player_badge_alert_operation (source_operation_id),
  KEY ix_player_badge_alert_unread (player_id,read_at,created_at),
  CONSTRAINT fk_player_badge_alert_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_player_badge_alert_operator FOREIGN KEY (actor_operator_id) REFERENCES admin_operators(id),
  CONSTRAINT fk_player_badge_alert_operation FOREIGN KEY (source_operation_id) REFERENCES operations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_special_badge_mutations (
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  badge_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mutation_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  assignment_priority INT NOT NULL,
  equipped_before BOOLEAN NOT NULL,
  equipment_version_before BIGINT UNSIGNED NULL,
  equipment_version_after BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_special_badge_mutation_operation FOREIGN KEY (operation_id) REFERENCES operations(id),
  CONSTRAINT fk_special_badge_mutation_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT chk_special_badge_mutation_kind CHECK (mutation_kind IN ('revoke'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO pet_home_badge_definitions(badge_code,badge_category,emoji,display_name,active,version)
VALUES
  ('S01','special','🎂','펫홈 1주년',TRUE,1),
  ('S02','special','🎊','이벤트 스타',TRUE,1),
  ('S03','special','🛠️','펫홈 개척자',TRUE,1),
  ('S04','special','🎖️','명예 유저',TRUE,1),
  ('S05','special','👑','공식 인증 홈',TRUE,1),
  ('S06','special','🛡️','공식 관리자',TRUE,1),
  ('S07','special','🏆','펫홈 콘테스트 우승',TRUE,1),
  ('S08','special','💎','특별 후원 감사',TRUE,1),
  ('S09','special','🌟','호이월드 공로자',TRUE,1),
  ('S10','special','🪽','전설의 홈',TRUE,1),
  ('S11','special','👑','황제',TRUE,1),
  ('S12','special','🎮','GM',TRUE,1),
  ('S13','special','🐺','호패 프리미엄',TRUE,1)
ON DUPLICATE KEY UPDATE badge_category=VALUES(badge_category),emoji=VALUES(emoji),display_name=VALUES(display_name),active=VALUES(active),version=VALUES(version);

INSERT INTO admin_permissions(code,display_name)
VALUES ('pet_home.special_badge.revoke','특별 펫홈 뱃지 회수')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name);

INSERT INTO admin_role_permissions(role_id,permission_code)
SELECT id,'pet_home.special_badge.revoke' FROM admin_roles WHERE code IN ('super_admin','manager')
ON DUPLICATE KEY UPDATE permission_code=VALUES(permission_code);

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_SPECIAL_BADGE_REVOKE','admin_special_badge_revoke','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),version=VALUES(version);

INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/특별뱃지회수','ADMIN_SPECIAL_BADGE_REVOKE',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
