ALTER TABLE event_inbox
  ADD COLUMN channel_id BIGINT UNSIGNED NULL AFTER external_channel_id,
  ADD COLUMN external_identity_id BIGINT UNSIGNED NULL AFTER external_user_id,
  ADD KEY idx_event_inbox_channel (channel_id),
  ADD KEY idx_event_inbox_identity (external_identity_id),
  ADD CONSTRAINT fk_event_inbox_channel FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_event_inbox_identity FOREIGN KEY (external_identity_id) REFERENCES external_identities (id) ON DELETE RESTRICT;

ALTER TABLE guilds ADD COLUMN mark VARCHAR(191) NULL AFTER display_name;
