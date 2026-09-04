ALTER TABLE user_verification_challenges
  DROP FOREIGN KEY fk_amgp_469_challenge_platform_identity,
  DROP FOREIGN KEY fk_amgp_469_challenge_player,
  DROP KEY idx_amgp_469_challenge_target,
  DROP COLUMN consumed_request_key,
  DROP COLUMN verified_platform_identity_id,
  DROP COLUMN external_context_key,
  DROP COLUMN context_type,
  DROP COLUMN identity_scope_key,
  DROP COLUMN platform_code,
  DROP COLUMN expected_display_name,
  DROP COLUMN target_player_id;
DROP TABLE IF EXISTS account_platform_operation_receipts;
DROP TABLE IF EXISTS account_platform_active_player_selections;
