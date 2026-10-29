DELETE FROM `calendar_items`
WHERE
  `kind` = 'event'
  AND `person` = 'sascha'
  AND `date` <= '2026-09-30'
  AND COALESCE(`end_date`, `date`) >= '2026-09-01';
