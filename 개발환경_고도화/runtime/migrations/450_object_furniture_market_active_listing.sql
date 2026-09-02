-- WBS734 Wave2: preserve cancelled/sold listing history while allowing one active listing per owned furniture.
-- Runs after 445_object_furniture_home_canonical_model.sql. MariaDB 11.4 supports STORED generated columns.
ALTER TABLE object_furniture_market_listings
  DROP INDEX uq_object_furniture_market_listing_owned,
  ADD COLUMN active_owned_furniture_id CHAR(8) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (CASE WHEN listing_status = 'active' THEN owned_furniture_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_object_furniture_market_active_owned (active_owned_furniture_id);
