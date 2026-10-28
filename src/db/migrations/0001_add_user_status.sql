-- Add user status (active/inactive) for account management.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Backfill any existing rows defensively.
UPDATE users SET status = 'active' WHERE status IS NULL;
