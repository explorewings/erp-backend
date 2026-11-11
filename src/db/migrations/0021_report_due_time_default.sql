-- Default report due time: 9:00 PM (Reports timezone). Superadmin/superuser can
-- still change it, or clear it to turn reminders off, from the Reports settings.
ALTER TABLE report_settings ALTER COLUMN due_time SET DEFAULT '21:00';

-- Fill the existing row only if nobody has saved settings yet, so a time (or an
-- explicit "off") someone already chose is never overwritten.
UPDATE report_settings
   SET due_time = '21:00'
 WHERE id = 1 AND due_time IS NULL AND updated_by IS NULL;
