-- WBS742: import locator와 payload를 분리해 source occurrence replay/drift를 검증합니다.
-- 기존 crosswalk row는 NULL을 유지해 선행 API와 데이터의 호환성을 보존합니다.
ALTER TABLE object_identity_crosswalks
  ADD COLUMN payload_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER source_identifier,
  ADD CONSTRAINT chk_object_identity_crosswalk_payload_fingerprint
    CHECK (payload_fingerprint IS NULL OR payload_fingerprint REGEXP '^[0-9a-f]{64}$');
