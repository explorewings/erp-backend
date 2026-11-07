ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS extension_request text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS completion_remarks text;
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_type_valid;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_type_valid CHECK (type IN ('task', 'announcement', 'meeting', 'followup'));
CREATE INDEX IF NOT EXISTS calendar_events_status_idx ON calendar_events (status);
