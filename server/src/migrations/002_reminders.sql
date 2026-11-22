ALTER TABLE bookings ADD COLUMN reminder_sent_at timestamptz;

INSERT INTO notification_templates(key,audience,subject,body) VALUES
 ('booking_reminder','customer','Reminder: your appointment on {{date}} at {{time}}','Hi {{name}},
This is a friendly reminder of your appointment with {{brand}}.
{{services}} on {{date}} at {{time}}
Venue: {{venue}}
Reference: {{reference}}
Please get in touch if you need to change anything.')
ON CONFLICT (key) DO NOTHING
