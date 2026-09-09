-- WBS746 G5: 계정 권위 판정과 계정 연결/전환 writer의 공용 직렬화 경계.
CREATE TABLE IF NOT EXISTS canonical_account_authority_global_locks (
  account_authority_global_lock_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lock_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lock_version BIGINT UNSIGNED NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (account_authority_global_lock_id),
  UNIQUE KEY uq_account_473_00_01 (lock_key),
  CONSTRAINT chk_account_473_00_rule_01 CHECK (lock_key='ACCOUNT_AUTHORITY'),
  CONSTRAINT chk_account_473_00_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_account_473_00_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO canonical_account_authority_global_locks(account_authority_global_lock_id,lock_key,lock_version,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME)
VALUES ('aalock01','ACCOUNT_AUTHORITY',1,'migration_473',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'),'migration_473',DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+09:00'),'%Y-%m-%d %H:%i:%s'))
ON DUPLICATE KEY UPDATE lock_key=VALUES(lock_key);
