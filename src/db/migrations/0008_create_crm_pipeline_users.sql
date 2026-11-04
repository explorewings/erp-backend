ALTER TABLE crm_pipelines
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS crm_pipeline_users (
  pipeline_id INTEGER NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_pipeline_users_pkey PRIMARY KEY (pipeline_id, user_id)
);

CREATE INDEX IF NOT EXISTS crm_pipeline_users_user_id_idx ON crm_pipeline_users(user_id);
