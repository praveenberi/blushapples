ALTER TABLE bookings ADD COLUMN admin_seen_at timestamptz;
ALTER TABLE bookings ADD COLUMN admin_alerted_at timestamptz;
ALTER TABLE bookings ADD COLUMN reschedule_history jsonb NOT NULL DEFAULT '[]';
UPDATE bookings SET admin_seen_at=now() WHERE status <> 'new';

INSERT INTO notification_templates(key,audience,subject,body) VALUES
 ('admin_booking_soon','admin','Coming up: {{name}} on {{date}} at {{time}}','{{name}} is booked for {{services}}
on {{date}} at {{time}}
Venue: {{venue}}
Status: {{status_label}}
Balance due: {{pending}}
Manage: {{link}}')
ON CONFLICT (key) DO NOTHING
