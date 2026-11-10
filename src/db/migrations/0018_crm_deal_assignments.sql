ALTER TABLE crm_deals
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO crm_pipeline_users (pipeline_id, user_id)
SELECT id, created_by
FROM crm_pipelines
WHERE created_by IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE crm_pipelines
  ADD COLUMN IF NOT EXISTS deal_assignment_method text NOT NULL DEFAULT 'creator_manual',
  ADD COLUMN IF NOT EXISTS round_robin_cursor integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_pipelines_deal_assignment_method_valid'
  ) THEN
    ALTER TABLE crm_pipelines
      ADD CONSTRAINT crm_pipelines_deal_assignment_method_valid
      CHECK (deal_assignment_method IN ('round_robin', 'creator_manual', 'least_loaded'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_pipelines_round_robin_cursor_nonnegative'
  ) THEN
    ALTER TABLE crm_pipelines
      ADD CONSTRAINT crm_pipelines_round_robin_cursor_nonnegative
      CHECK (round_robin_cursor >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_deals_pipeline_assigned_user_idx
  ON crm_deals (pipeline_id, assigned_user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_deals_pipeline_assignee_fk'
  ) THEN
    ALTER TABLE crm_deals
      ADD CONSTRAINT crm_deals_pipeline_assignee_fk
      FOREIGN KEY (pipeline_id, assigned_user_id)
      REFERENCES crm_pipeline_users (pipeline_id, user_id)
      ON DELETE RESTRICT;
  END IF;
END $$;
