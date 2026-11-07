-- Calendar v2 (docs/calendar-plan.md, section 5).
-- Rebuilds the calendar tables on the v2 model. The v1 tables held no data when
-- this was written; the guard below refuses to run if that is no longer true,
-- so nothing is ever dropped silently.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_events')
     AND EXISTS (SELECT 1 FROM calendar_events) THEN
    RAISE EXCEPTION 'calendar_events has rows; write a data-preserving migration instead of 0011.';
  END IF;
END $$;

DROP TABLE IF EXISTS calendar_assignees;
DROP TABLE IF EXISTS calendar_events CASCADE;

CREATE TABLE calendar_events (
  id SERIAL PRIMARY KEY,
  type text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location text,
  visibility text,
  priority text,
  image_url text,
  assignee_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  previous_status text,
  hold_reason text,
  hold_until timestamptz,
  cancel_reason text,
  reject_count integer NOT NULL DEFAULT 0,
  completion_remarks text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_events_title_not_empty CHECK (BTRIM(title) <> ''),
  CONSTRAINT calendar_events_type_valid CHECK (type IN ('task', 'announcement', 'meeting', 'followup')),
  CONSTRAINT calendar_events_ends_after_starts CHECK (ends_at >= starts_at),
  CONSTRAINT calendar_events_status_by_type CHECK (
    (type = 'task' AND status IN ('assigned', 'progress', 'on_review', 'completed', 'on_hold', 'request_cancelation', 'cancelled', 'failed'))
    OR (type IN ('announcement', 'meeting') AND status IN ('scheduled', 'cancelled'))
    OR (type = 'followup' AND status IN ('assigned', 'completed', 'cancelled'))
  ),
  CONSTRAINT calendar_events_assignee_by_type CHECK (
    (type IN ('task', 'followup') AND assignee_id IS NOT NULL)
    OR (type IN ('announcement', 'meeting') AND assignee_id IS NULL)
  ),
  CONSTRAINT calendar_events_visibility_valid CHECK (
    (type = 'meeting' AND visibility IN ('open', 'private'))
    OR (type <> 'meeting' AND visibility IS NULL)
  ),
  CONSTRAINT calendar_events_priority_valid CHECK (
    (type = 'task' AND priority IN ('low', 'medium', 'high', 'urgent'))
    OR (type <> 'task' AND priority IS NULL)
  ),
  CONSTRAINT calendar_events_hold_complete CHECK (status <> 'on_hold' OR (hold_until IS NOT NULL AND previous_status IS NOT NULL)),
  CONSTRAINT calendar_events_reject_count_positive CHECK (reject_count >= 0)
);

CREATE INDEX calendar_events_starts_at_idx ON calendar_events (starts_at);
CREATE INDEX calendar_events_ends_at_idx ON calendar_events (ends_at);
CREATE INDEX calendar_events_type_idx ON calendar_events (type);
CREATE INDEX calendar_events_status_idx ON calendar_events (status);
CREATE INDEX calendar_events_created_by_idx ON calendar_events (created_by);
CREATE INDEX calendar_events_assignee_id_idx ON calendar_events (assignee_id);
CREATE INDEX calendar_events_live_idx ON calendar_events (deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE calendar_meeting_members (
  event_id integer NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_meeting_members_unique UNIQUE (event_id, user_id)
);
CREATE INDEX calendar_meeting_members_user_idx ON calendar_meeting_members (user_id);

CREATE TABLE calendar_event_log (
  id SERIAL PRIMARY KEY,
  event_id integer NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_event_log_event_idx ON calendar_event_log (event_id);
CREATE INDEX calendar_event_log_created_idx ON calendar_event_log (created_at DESC);
