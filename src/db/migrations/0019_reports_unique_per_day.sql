-- One report per person per day.
--
-- If historical duplicates exist this migration fails loudly instead of
-- deleting data, because a duplicate row may already carry reviewer remarks or
-- an attachment. Resolve them manually, then re-run the migration:
--
--   SELECT created_by, report_date, count(*)
--   FROM reports
--   GROUP BY created_by, report_date
--   HAVING count(*) > 1;
--
-- Note: created_by is nullable (ON DELETE SET NULL), and NULLs never collide
-- in a UNIQUE constraint, so orphaned rows are unaffected.

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT 1
    FROM reports
    WHERE created_by IS NOT NULL
    GROUP BY created_by, report_date
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add reports_created_by_report_date_unique: % duplicate (user, date) group(s) exist. Resolve them first.',
      duplicate_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_created_by_report_date_unique'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_created_by_report_date_unique
      UNIQUE (created_by, report_date);
  END IF;
END $$;
