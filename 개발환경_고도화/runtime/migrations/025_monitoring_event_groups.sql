ALTER TABLE normalized_provider_events
  ADD COLUMN monitoring_group VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER event_category;

UPDATE normalized_provider_events
SET monitoring_group = CASE
  WHEN event_code = 'message.created.text' THEN 'text'
  WHEN event_code LIKE 'media.%' THEN 'media'
  WHEN event_code IN ('message.created.reply', 'message.created.thread_reply', 'message.created.reply_candidate') THEN 'reply'
  WHEN event_code IN ('message.deleted', 'message.hidden_by_host', 'message.edited', 'message.rewritten') THEN 'moderation'
  WHEN event_code IN ('member.joined', 'member.departed') THEN 'membership'
  ELSE 'event'
END
WHERE monitoring_group IS NULL;

ALTER TABLE normalized_provider_events
  MODIFY COLUMN monitoring_group VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD CONSTRAINT chk_normalized_provider_event_monitoring_group
    CHECK (monitoring_group IN ('text', 'media', 'reply', 'moderation', 'membership', 'event')),
  ADD KEY idx_normalized_provider_event_monitoring_group_created (monitoring_group, created_at);
