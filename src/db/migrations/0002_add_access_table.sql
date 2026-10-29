CREATE TABLE IF NOT EXISTS access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'menu',
  allowed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT access_user_code_unique UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS access_user_id_idx ON access (user_id);
