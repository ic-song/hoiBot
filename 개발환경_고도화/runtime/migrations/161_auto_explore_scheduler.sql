START TRANSACTION;

CREATE TABLE pet_explore_scheduler_allowed_channels (
  external_channel_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  note VARCHAR(255) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (external_channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pet_explore_scheduler_state (
  schedule_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  immediate_run_pending BOOLEAN NOT NULL DEFAULT FALSE,
  interval_minutes INT UNSIGNED NOT NULL DEFAULT 60,
  next_run_at DATETIME(3) NULL,
  generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lease_owner VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  lease_until DATETIME(3) NULL,
  started_operation_id BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (schedule_code),
  CONSTRAINT fk_pet_explore_scheduler_operation FOREIGN KEY (started_operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pet_explore_scheduler_interval CHECK (interval_minutes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pet_explore_scheduler_state(schedule_code,active,immediate_run_pending,interval_minutes)
VALUES ('pet_explore',FALSE,FALSE,60)
ON DUPLICATE KEY UPDATE schedule_code=VALUES(schedule_code);

CREATE TABLE pet_explore_scheduler_start_events (
  operation_id BIGINT UNSIGNED NOT NULL,
  schedule_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_active BOOLEAN NOT NULL,
  previous_immediate_run_pending BOOLEAN NOT NULL,
  previous_next_run_at DATETIME(3) NULL,
  state_changed BOOLEAN NOT NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  CONSTRAINT fk_pet_explore_scheduler_start_operation FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pet_explore_scheduler_start_state FOREIGN KEY (schedule_code) REFERENCES pet_explore_scheduler_state(schedule_code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO command_registry(command_code,handler_key,auth_scope,rollout_state,enabled,version)
VALUES ('ADMIN_AUTO_EXPLORE_SCHEDULER_START','auto_explore_scheduler_start','VERIFIED_USER','SHADOW',1,1)
ON DUPLICATE KEY UPDATE handler_key=VALUES(handler_key),auth_scope=VALUES(auth_scope),enabled=VALUES(enabled),version=version+1;
INSERT INTO command_aliases(command_text,command_code,active)
VALUES ('/자동탐험시작','ADMIN_AUTO_EXPLORE_SCHEDULER_START',1)
ON DUPLICATE KEY UPDATE command_code=VALUES(command_code),active=VALUES(active);

COMMIT;
