ALTER TABLE moderation_incidents
  DROP CONSTRAINT chk_moderation_incident_type,
  ADD CONSTRAINT chk_moderation_incident_type
    CHECK (incident_type IN ('message_edited', 'message_deleted', 'message_hidden_by_host'));
