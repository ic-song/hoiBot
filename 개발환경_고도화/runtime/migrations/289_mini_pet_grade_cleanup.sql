START TRANSACTION;

CREATE TABLE mini_pet_grade_definitions (
  grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  grade_order INT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (grade_code),
  UNIQUE KEY uq_mini_pet_grade_display (display_name),
  UNIQUE KEY uq_mini_pet_grade_order (grade_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mini_pet_grade_definitions(grade_code,display_name,grade_order) VALUES
('normal','일반',1),('advanced','고급',2),('rare','레어',3),('unique','유니크',4),('legendary','전설',5),('mythic','신화',6),('transcendent','초월',7),('primordial','태초',8),('primordial_plus','태초+',9),('genesis','창세',10),('creation','창조',11)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),grade_order=VALUES(grade_order),active=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3);

CREATE TABLE mini_pet_grade_cleanup_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  target_grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_grade_order INT UNSIGNED NOT NULL,
  removed_count INT UNSIGNED NOT NULL,
  point_delta BIGINT NOT NULL,
  balance_before DECIMAL(30,3) NOT NULL,
  balance_after DECIMAL(30,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mini_pet_grade_cleanup_operation (operation_id),
  CONSTRAINT fk_mini_pet_grade_cleanup_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_grade_cleanup_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_grade_cleanup_grade FOREIGN KEY (target_grade_code) REFERENCES mini_pet_grade_definitions(grade_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mini_pet_grade_cleanup_lines (
  cleanup_run_id BIGINT UNSIGNED NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  owned_mini_pet_id BIGINT UNSIGNED NOT NULL,
  mini_pet_definition_id BIGINT UNSIGNED NOT NULL,
  grade_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grade_order INT UNSIGNED NOT NULL,
  previous_bag_sequence BIGINT UNSIGNED NULL,
  sale_price BIGINT NOT NULL,
  snapshot_json JSON NOT NULL,
  PRIMARY KEY (cleanup_run_id,sequence_no),
  UNIQUE KEY uq_mini_pet_grade_cleanup_owned (owned_mini_pet_id),
  CONSTRAINT fk_mini_pet_grade_cleanup_line_run FOREIGN KEY (cleanup_run_id) REFERENCES mini_pet_grade_cleanup_runs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_grade_cleanup_line_definition FOREIGN KEY (mini_pet_definition_id) REFERENCES mini_pet_definitions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mini_pet_grade_cleanup_line_grade FOREIGN KEY (grade_code) REFERENCES mini_pet_grade_definitions(grade_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES('MINI_PET_GRADE_CLEANUP','mini_pet_grade_cleanup','VERIFIED_USER','SHADOW',TRUE,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),rollout_state=VALUES(rollout_state),enabled=VALUES(enabled),version=version+1;

INSERT INTO command_aliases(command_text,command_code,active)
VALUES('/미니펫등급정리','MINI_PET_GRADE_CLEANUP',TRUE)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
