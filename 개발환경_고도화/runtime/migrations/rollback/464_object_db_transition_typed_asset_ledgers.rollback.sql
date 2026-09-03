-- Destructive rollback: use only before consumer cutover or after confirming transition receipts are dispensable.
DROP TABLE IF EXISTS canonical_package_use_reward_ledger_entries;
DROP TABLE IF EXISTS canonical_market_transfer_ledger_entries;

