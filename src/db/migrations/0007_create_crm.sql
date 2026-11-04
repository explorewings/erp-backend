CREATE TABLE IF NOT EXISTS crm_pipelines (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_pipelines_name_not_empty CHECK (BTRIM(name) <> ''),
  CONSTRAINT crm_pipelines_position_nonnegative CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS crm_pipelines_position_idx ON crm_pipelines(position, id);

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id SERIAL PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_pipeline_stages_name_not_empty CHECK (BTRIM(name) <> ''),
  CONSTRAINT crm_pipeline_stages_position_nonnegative CHECK (position >= 0),
  CONSTRAINT crm_pipeline_stages_pipeline_name_unique UNIQUE (pipeline_id, name)
);

CREATE INDEX IF NOT EXISTS crm_pipeline_stages_pipeline_id_idx ON crm_pipeline_stages(pipeline_id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stages_pipeline_id_id_unique_idx ON crm_pipeline_stages(pipeline_id, id);
CREATE INDEX IF NOT EXISTS crm_pipeline_stages_pipeline_position_idx ON crm_pipeline_stages(pipeline_id, position);

CREATE TABLE IF NOT EXISTS crm_deals (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pipeline_id INTEGER NOT NULL REFERENCES crm_pipelines(id) ON DELETE RESTRICT,
  stage_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_deals_unique_pipeline_client UNIQUE (pipeline_id, client_id)
);

DO $$ BEGIN
  ALTER TABLE crm_deals
    ADD CONSTRAINT crm_deals_pipeline_stage_fk
    FOREIGN KEY (pipeline_id, stage_id)
    REFERENCES crm_pipeline_stages(pipeline_id, id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS crm_deals_client_id_idx ON crm_deals(client_id);
CREATE INDEX IF NOT EXISTS crm_deals_pipeline_stage_idx ON crm_deals(pipeline_id, stage_id);
