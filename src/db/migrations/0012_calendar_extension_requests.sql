-- Extension requests (decisions 2026-11-08, D9): an assignee may ask for a later
-- deadline while a task is assigned, in progress or failed. One pending request at
-- a time; the status does not change until the creator/superadmin decides.
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS extension_until timestamptz;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS extension_reason text;

ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_extension_complete;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_extension_complete CHECK (
  (extension_until IS NULL AND extension_reason IS NULL)
  OR (type = 'task' AND extension_until IS NOT NULL AND extension_reason IS NOT NULL
      AND status IN ('assigned', 'progress', 'failed'))
);
