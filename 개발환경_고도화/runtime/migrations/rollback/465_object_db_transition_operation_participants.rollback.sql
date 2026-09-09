-- Destructive rollback: use only before consumer cutover or after confirming transition receipts are dispensable.
DROP TABLE IF EXISTS canonical_player_identity_operation_participants;
DROP TABLE IF EXISTS canonical_pet_title_operation_participants;
DROP TABLE IF EXISTS canonical_mini_pet_title_operation_participants;
DROP TABLE IF EXISTS canonical_member_title_operation_participants;
DROP TABLE IF EXISTS canonical_market_operation_participants;
DROP TABLE IF EXISTS canonical_home_aggregate_operation_participants;

