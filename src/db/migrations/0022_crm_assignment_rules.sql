-- Pipeline assignment rules: split 'creator_manual' into 'creator' (the person
-- who adds a deal owns it) and 'manual' (new deals stay unassigned).
-- Existing 'creator_manual' pipelines keep their behaviour as 'creator'.

ALTER TABLE crm_pipelines
  DROP CONSTRAINT IF EXISTS crm_pipelines_deal_assignment_method_valid;

UPDATE crm_pipelines
SET deal_assignment_method = 'creator'
WHERE deal_assignment_method = 'creator_manual';

ALTER TABLE crm_pipelines
  ALTER COLUMN deal_assignment_method SET DEFAULT 'creator';

ALTER TABLE crm_pipelines
  ADD CONSTRAINT crm_pipelines_deal_assignment_method_valid
  CHECK (deal_assignment_method IN ('round_robin', 'least_loaded', 'creator', 'manual'));

-- Distribute picks the oldest unassigned deals of a pipeline first.
CREATE INDEX IF NOT EXISTS crm_deals_pipeline_unassigned_idx
  ON crm_deals (pipeline_id, created_at, id)
  WHERE assigned_user_id IS NULL;
