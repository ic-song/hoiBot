ALTER TABLE mini_pet_owner_read_snapshots
  ADD CONSTRAINT fk_mini_pet_owner_snapshot_version
  FOREIGN KEY (environment_code, snapshot_version)
  REFERENCES mini_pet_owned_snapshot_versions(environment_code, snapshot_version);
