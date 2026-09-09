-- Destructive rollback: use only before consumer cutover or after confirming transition receipts are dispensable.
DROP TABLE IF EXISTS canonical_app_wiring_operations;

