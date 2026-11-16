-- WI-1b: pipeline-level history of Assign users drawer actions.
-- One row per action (or per ≤100-deal chunk of a bulk run, grouped by run_id).
CREATE TABLE IF NOT EXISTS crm_pipeline_activity (
  id          serial PRIMARY KEY,
  pipeline_id integer NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name  text,
  action      text NOT NULL,
  run_id      uuid,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_pipeline_activity_action_valid CHECK (
    action IN ('rule_changed', 'rule_auto_changed', 'deals_assigned', 'deals_unassigned', 'access_changed')
  )
);

CREATE INDEX IF NOT EXISTS crm_pipeline_activity_feed_idx
  ON crm_pipeline_activity (pipeline_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS crm_pipeline_activity_run_idx
  ON crm_pipeline_activity (pipeline_id, run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_pipeline_activity_actor_idx
  ON crm_pipeline_activity (actor_id);
