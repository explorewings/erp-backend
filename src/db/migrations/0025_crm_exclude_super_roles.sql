-- Super roles (superadmin, superuser) see every pipeline and configure deal
-- assignment. They never own deals and never sit in a pipeline's access list.

-- 1. Unassign any deal they own (must happen before their access rows go:
--    crm_deals (pipeline_id, assigned_user_id) references crm_pipeline_users).
UPDATE crm_deals AS d
SET assigned_user_id = NULL, assignment_source = NULL, updated_at = now()
FROM users AS u
WHERE u.id = d.assigned_user_id
  AND u.role IN ('superadmin', 'superuser');

-- 2. A pipeline whose single-user target is a super role falls back to manual.
UPDATE crm_pipelines AS p
SET deal_assignment_method = 'manual', deal_assignment_user_id = NULL, updated_at = now()
FROM users AS u
WHERE u.id = p.deal_assignment_user_id
  AND u.role IN ('superadmin', 'superuser');

-- 3. Remove them from every access list.
DELETE FROM crm_pipeline_users AS pu
USING users AS u
WHERE u.id = pu.user_id
  AND u.role IN ('superadmin', 'superuser');
