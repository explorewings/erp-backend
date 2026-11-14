-- How each deal's current owner was assigned: by a pipeline rule
-- ('round_robin' | 'single_user' | 'creator') or by hand ('manual').
-- NULL = unassigned, or assigned before this column existed (unknown).
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS assignment_source text;

ALTER TABLE crm_deals DROP CONSTRAINT IF EXISTS crm_deals_assignment_source_valid;
ALTER TABLE crm_deals ADD CONSTRAINT crm_deals_assignment_source_valid
  CHECK (assignment_source IS NULL OR assignment_source IN ('round_robin', 'single_user', 'creator', 'manual'));

CREATE INDEX IF NOT EXISTS crm_deals_pipeline_assignment_source_idx
  ON crm_deals (pipeline_id, assignment_source)
  WHERE assigned_user_id IS NOT NULL;
