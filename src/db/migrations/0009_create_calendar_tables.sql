CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  title text NOT NULL,
  description text,
  type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_title_not_empty CHECK (BTRIM(title) <> ''),
  CONSTRAINT calendar_events_type_valid CHECK (type IN ('task', 'announcement', 'meeting')),
  CONSTRAINT calendar_events_ends_after_starts CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS calendar_events_starts_at_idx ON calendar_events (starts_at);
CREATE INDEX IF NOT EXISTS calendar_events_type_idx ON calendar_events (type);
CREATE INDEX IF NOT EXISTS calendar_events_created_by_idx ON calendar_events (created_by);

CREATE TABLE IF NOT EXISTS calendar_assignees (
  event_id integer NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_assignees_event_user_unique UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS calendar_assignees_event_id_idx ON calendar_assignees (event_id);
CREATE INDEX IF NOT EXISTS calendar_assignees_user_id_idx ON calendar_assignees (user_id);
