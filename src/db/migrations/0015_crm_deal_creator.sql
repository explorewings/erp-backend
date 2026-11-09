-- Who added a client into a pipeline (deal provenance).
-- Deals previously recorded only `created_at`; the deal drawer could not
-- show "added by". NULL for legacy deals (actor unknown).

ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS crm_deals_created_by_idx ON crm_deals (created_by);

-- Client activity log now also records pipeline adds, so the client
-- History thread shows "X added this client to pipeline Y".
ALTER TABLE client_activity_log
  DROP CONSTRAINT IF EXISTS client_activity_action_valid;
ALTER TABLE client_activity_log
  ADD CONSTRAINT client_activity_action_valid CHECK (action IN ('created', 'updated', 'added_to_pipeline'));
