-- 0007_create_crm.sql (a duplicate of 0007_create_crm_tables.sql, since removed)
-- added two indexes that duplicate existing ones:
--   * crm_pipeline_stages_pipeline_id_id_unique_idx duplicates the
--     crm_pipeline_stages_pipeline_id_id_unique constraint.
--   * crm_pipeline_stages_pipeline_id_idx is covered by the
--     (pipeline_id, id) and (pipeline_id, position) indexes.
DROP INDEX IF EXISTS crm_pipeline_stages_pipeline_id_id_unique_idx;
DROP INDEX IF EXISTS crm_pipeline_stages_pipeline_id_idx;
