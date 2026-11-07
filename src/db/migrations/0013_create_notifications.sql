-- Shared notifications (any module writes, the header bell reads).
-- One row per recipient; read state is per row.
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  module text NOT NULL,
  kind text NOT NULL,
  entity_type text,
  entity_id text,
  title text NOT NULL,
  body text,
  link text,
  meta jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_title_not_empty CHECK (BTRIM(title) <> '')
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
