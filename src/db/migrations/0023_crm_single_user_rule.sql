-- Replace the 'least_loaded' rule with 'single_user': every deal goes to one
-- chosen user. Pipelines still on least_loaded fall back to round_robin (the
-- closest "share evenly" behaviour).

ALTER TABLE crm_pipelines
  ADD COLUMN IF NOT EXISTS deal_assignment_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE crm_pipelines
  DROP CONSTRAINT IF EXISTS crm_pipelines_deal_assignment_method_valid;

UPDATE crm_pipelines
SET deal_assignment_method = 'round_robin', round_robin_cursor = 0
WHERE deal_assignment_method = 'least_loaded';

ALTER TABLE crm_pipelines
  ADD CONSTRAINT crm_pipelines_deal_assignment_method_valid
  CHECK (deal_assignment_method IN ('round_robin', 'single_user', 'creator', 'manual'));

CREATE INDEX IF NOT EXISTS crm_pipelines_deal_assignment_user_id_idx
  ON crm_pipelines (deal_assignment_user_id);
