ALTER TABLE data_migration_catalog_projection_runs
  ADD COLUMN raw_bundle_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER common_staging_run_id,
  ADD COLUMN snapshot_manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER raw_bundle_sha256,
  ADD COLUMN extraction_manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER snapshot_manifest_sha256,
  ADD COLUMN expected_file_count INT UNSIGNED NULL AFTER extraction_manifest_sha256,
  ADD COLUMN expected_total_bytes BIGINT UNSIGNED NULL AFTER expected_file_count,
  ADD COLUMN projected_file_count INT UNSIGNED NULL AFTER expected_total_bytes,
  ADD COLUMN ignored_file_count INT UNSIGNED NULL AFTER projected_file_count,
  ADD COLUMN upstream_envelope_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER ignored_file_count;

UPDATE data_migration_catalog_projection_runs projection
JOIN data_migration_common_staging_runs staging ON staging.common_staging_run_id=projection.common_staging_run_id
SET projection.raw_bundle_sha256=staging.raw_bundle_sha256,
    projection.snapshot_manifest_sha256=staging.snapshot_manifest_sha256,
    projection.extraction_manifest_sha256=staging.extraction_manifest_sha256,
    projection.expected_file_count=staging.expected_file_count,
    projection.expected_total_bytes=staging.expected_total_bytes,
    projection.projected_file_count=staging.projected_file_count,
    projection.ignored_file_count=staging.ignored_file_count,
    projection.upstream_envelope_sha256=SHA2(CONCAT(
      '{"expectedFileCount":',staging.expected_file_count,
      ',"expectedTotalBytes":"',staging.expected_total_bytes,
      '","extractionManifestSha256":"',staging.extraction_manifest_sha256,
      '","ignoredFileCount":',staging.ignored_file_count,
      ',"projectedFileCount":',staging.projected_file_count,
      ',"rawBundleSha256":"',staging.raw_bundle_sha256,
      '","snapshotManifestSha256":"',staging.snapshot_manifest_sha256,
      '","stagingSha256":"',staging.staging_sha256,'"}'
    ),256);

ALTER TABLE data_migration_catalog_projection_runs
  MODIFY raw_bundle_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY snapshot_manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY extraction_manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY expected_file_count INT UNSIGNED NOT NULL,
  MODIFY expected_total_bytes BIGINT UNSIGNED NOT NULL,
  MODIFY projected_file_count INT UNSIGNED NOT NULL,
  MODIFY ignored_file_count INT UNSIGNED NOT NULL,
  MODIFY upstream_envelope_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD CONSTRAINT chk_catalog_projection_raw_bundle_hash CHECK (raw_bundle_sha256 REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_catalog_projection_snapshot_manifest_hash CHECK (snapshot_manifest_sha256 REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_catalog_projection_extraction_manifest_hash CHECK (extraction_manifest_sha256 REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_catalog_projection_upstream_envelope_hash CHECK (upstream_envelope_sha256 REGEXP '^[0-9a-f]{64}$'),
  ADD CONSTRAINT chk_catalog_projection_file_counts CHECK (projected_file_count + ignored_file_count = expected_file_count);
