START TRANSACTION;

DROP TABLE IF EXISTS market_mini_pet_transfer_ledger;

ALTER TABLE market_mini_pet_reservations
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (listing_id);

COMMIT;
