-- Client provenance + activity history.
-- Clients are the source of truth for CRM, so the first record of a client
-- (who added it, when, and from where) lives here. Mirrors the calendar
-- pattern: calendar_events.created_by + calendar_event_log for the thread.

-- Who first added the client, and where it came from: 'manual' (entered in
-- the UI, including via CRM Add-deal) or 'imported' (bulk import batch).
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_source_valid;
ALTER TABLE clients
  ADD CONSTRAINT clients_source_valid CHECK (source IN ('manual', 'imported'));

-- Existing rows: imported clients are those linked to an import record.
UPDATE clients SET source = 'imported' WHERE import_id IS NOT NULL;
UPDATE clients SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS clients_created_by_idx ON clients (created_by);

-- Thread/audit log for a client: who did what, when. Same shape as
-- calendar_event_log. `action` is 'created' or 'updated' today;
-- `meta` carries source/import info and changed field names.
CREATE TABLE IF NOT EXISTS client_activity_log (
  id SERIAL PRIMARY KEY,
  client_id integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_activity_action_valid CHECK (action IN ('created', 'updated'))
);
CREATE INDEX IF NOT EXISTS client_activity_log_client_idx ON client_activity_log (client_id);
CREATE INDEX IF NOT EXISTS client_activity_log_created_idx ON client_activity_log (created_at DESC);

-- Backfill one 'created' entry per existing client so history is complete
-- from day one. Actor is unknown for legacy rows (NULL -> shown as System).
INSERT INTO client_activity_log (client_id, actor_id, action, meta, created_at)
SELECT
  id,
  created_by,
  'created',
  jsonb_build_object('source', source, 'importId', import_id),
  created_at
FROM clients
WHERE NOT EXISTS (
  SELECT 1 FROM client_activity_log WHERE client_id = clients.id AND action = 'created'
);
