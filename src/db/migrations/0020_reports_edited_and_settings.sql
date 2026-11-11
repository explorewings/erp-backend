-- 1. "Edited" tag: set when a report's content (date, points or attachment)
--    changes after submission. Remarks do not count as an edit.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- 2. Module-wide Reports settings, a single row (id = 1).
--    due_time  — time of day (Asia/Kolkata) a day's report is due; NULL turns
--                the "report not submitted" reminder off.
--    skip_days — weekdays with no reminder, 0 = Sunday … 6 = Saturday.
CREATE TABLE IF NOT EXISTS report_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  due_time TIME,
  skip_days SMALLINT[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_settings_single_row CHECK (id = 1),
  CONSTRAINT report_settings_skip_days_valid CHECK (skip_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[])
);

INSERT INTO report_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
