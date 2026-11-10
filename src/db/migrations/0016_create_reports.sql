CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  reports JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attachment_type TEXT,
  attachment_url TEXT,
  attachment_key TEXT,
  attachment_name TEXT,
  attachment_content_type TEXT,
  attachment_size INTEGER,
  remarks TEXT,
  CONSTRAINT reports_items_array CHECK (jsonb_typeof(reports) = 'array'),
  CONSTRAINT reports_attachment_type_valid CHECK (attachment_type IS NULL OR attachment_type IN ('url', 'file')),
  CONSTRAINT reports_attachment_size_nonnegative CHECK (attachment_size IS NULL OR attachment_size >= 0),
  CONSTRAINT reports_attachment_shape CHECK (
    (attachment_type IS NULL AND attachment_url IS NULL AND attachment_key IS NULL
      AND attachment_name IS NULL AND attachment_content_type IS NULL AND attachment_size IS NULL)
    OR (attachment_type = 'url' AND attachment_url IS NOT NULL AND attachment_key IS NULL
      AND attachment_name IS NULL AND attachment_content_type IS NULL AND attachment_size IS NULL)
    OR (attachment_type = 'file' AND attachment_url IS NULL AND attachment_key IS NOT NULL
      AND attachment_name IS NOT NULL AND attachment_content_type IS NOT NULL AND attachment_size IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS reports_report_date_idx ON reports (report_date);
CREATE INDEX IF NOT EXISTS reports_created_by_idx ON reports (created_by);
CREATE INDEX IF NOT EXISTS reports_submitted_at_idx ON reports (submitted_at DESC);

INSERT INTO access_items (code, type, name, description, display_order)
VALUES ('menu:reports', 'menu', 'Reports', 'Submit and review daily reports.', 6)
ON CONFLICT (code) DO NOTHING;

INSERT INTO access (user_id, code, type, allowed)
SELECT id, 'menu:reports', 'menu', false FROM users
ON CONFLICT (user_id, code) DO NOTHING;

UPDATE access_items SET display_order = 7 WHERE code = 'menu:settings';
