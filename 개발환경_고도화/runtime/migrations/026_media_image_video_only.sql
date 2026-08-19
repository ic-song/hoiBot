UPDATE normalized_provider_events
SET monitoring_group = 'event'
WHERE monitoring_group = 'media'
  AND event_code NOT IN (
    'media.image',
    'media.image_candidate',
    'media.multi_image',
    'media.multi_image_candidate',
    'media.video',
    'media.video_candidate'
  );
