-- Destructive rollback: use only before consumer cutover or after confirming transition receipts are dispensable.
DROP TABLE IF EXISTS canonical_player_identity_operations;
DROP TABLE IF EXISTS canonical_pet_title_operations;
DROP TABLE IF EXISTS canonical_pet_explore_operations;
DROP TABLE IF EXISTS canonical_package_use_operations;
DROP TABLE IF EXISTS canonical_mini_pet_title_operations;
DROP TABLE IF EXISTS canonical_member_title_operations;
DROP TABLE IF EXISTS canonical_market_operations;
DROP TABLE IF EXISTS canonical_home_aggregate_operations;
DROP TABLE IF EXISTS canonical_daily_prayer_operations;

