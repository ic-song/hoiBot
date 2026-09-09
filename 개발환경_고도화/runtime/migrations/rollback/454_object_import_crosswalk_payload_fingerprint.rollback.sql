ALTER TABLE object_identity_crosswalks
  DROP CONSTRAINT chk_object_identity_crosswalk_payload_fingerprint,
  DROP COLUMN payload_fingerprint;
