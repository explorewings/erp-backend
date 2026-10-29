CREATE TABLE IF NOT EXISTS access_items (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'menu',
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO access_items (code, type, name, description, display_order) VALUES
  ('menu:calendar', 'menu', 'Calendar', 'Bookings and schedules in one view.', 1),
  ('menu:clients', 'menu', 'Clients', 'Customer records and their details.', 2),
  ('menu:crm', 'menu', 'CRM', 'Pipeline, leads, and follow-ups.', 3),
  ('menu:resorts', 'menu', 'Resorts', 'Resort listings, pricing, and imagery.', 4),
  ('menu:packages', 'menu', 'Packages', 'Itineraries, durations, and pricing.', 5),
  ('menu:settings', 'menu', 'Settings', 'Workspace preferences.', 6)
ON CONFLICT (code) DO NOTHING;
