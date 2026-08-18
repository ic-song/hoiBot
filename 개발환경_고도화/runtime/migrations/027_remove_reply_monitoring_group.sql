UPDATE normalized_provider_events
SET monitoring_group = 'event'
WHERE monitoring_group = 'reply';

ALTER TABLE normalized_provider_events
  DROP CONSTRAINT chk_normalized_provider_event_monitoring_group,
  ADD CONSTRAINT chk_normalized_provider_event_monitoring_group
    CHECK (monitoring_group IN ('text', 'media', 'moderation', 'membership', 'event'));
