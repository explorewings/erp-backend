CREATE TABLE IF NOT EXISTS client_imports (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  total_rows INTEGER NOT NULL,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT client_imports_status_valid
    CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT client_imports_row_counts_valid
    CHECK (total_rows BETWEEN 1 AND 500 AND imported_rows BETWEEN 0 AND total_rows)
);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS import_id INTEGER REFERENCES client_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_imports_created_at_idx ON client_imports(created_at DESC);
CREATE INDEX IF NOT EXISTS clients_import_id_idx ON clients(import_id);
