START TRANSACTION;
DELETE FROM command_aliases WHERE command_text='/미니펫거래등록' AND command_code='MARKET_MINIPET_TRADE_REGISTER';
DELETE FROM command_registry WHERE command_code='MARKET_MINIPET_TRADE_REGISTER';
DROP TABLE IF EXISTS market_mini_pet_registration_ledger;
DROP TABLE IF EXISTS market_mini_pet_registration_confirmations;
COMMIT;
