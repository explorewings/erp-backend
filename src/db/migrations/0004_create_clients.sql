CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT clients_email_or_phone_required
    CHECK (
      NULLIF(BTRIM(email), '') IS NOT NULL
      OR NULLIF(BTRIM(phone_number), '') IS NOT NULL
    )
);
