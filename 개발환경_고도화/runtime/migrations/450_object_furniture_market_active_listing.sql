-- WBS734 Wave2: preserve cancelled/sold listing history while allowing one active listing per owned furniture.
-- Runs after 445_object_furniture_home_canonical_model.sql.
CREATE INDEX IF NOT EXISTS idx_object_furniture_market_owned ON object_furniture_market_listings (owned_furniture_id);
DROP INDEX IF EXISTS uq_object_furniture_market_listing_owned ON object_furniture_market_listings;

CREATE TABLE IF NOT EXISTS object_furniture_active_market_listings (
  furniture_market_listing_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owned_furniture_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  INSERT_USER VARCHAR(100) NOT NULL,
  INSERT_TIME CHAR(19) NOT NULL,
  UPDATE_USER VARCHAR(100) NOT NULL,
  UPDATE_TIME CHAR(19) NOT NULL,
  PRIMARY KEY (furniture_market_listing_id),
  UNIQUE KEY uq_object_furniture_active_market_owned (owned_furniture_id),
  CONSTRAINT fk_object_furniture_active_market_listing FOREIGN KEY (furniture_market_listing_id) REFERENCES object_furniture_market_listings (furniture_market_listing_id) ON DELETE RESTRICT,
  CONSTRAINT fk_object_furniture_active_market_owned FOREIGN KEY (owned_furniture_id) REFERENCES object_owned_furniture_instances (owned_furniture_id) ON DELETE RESTRICT,
  CONSTRAINT chk_object_furniture_active_market_insert_time CHECK (INSERT_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'),
  CONSTRAINT chk_object_furniture_active_market_update_time CHECK (UPDATE_TIME REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
