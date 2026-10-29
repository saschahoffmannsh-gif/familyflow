UPDATE `calendar_items`
SET
  `person` = NULL,
  `revision` = `revision` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `event_type` = 'holidays' AND `person` IS NOT NULL;
