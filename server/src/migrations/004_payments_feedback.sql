ALTER TABLE bookings ADD COLUMN deposit_cents integer NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN balance_paid_cents integer NOT NULL DEFAULT 0;

CREATE TABLE feedback_requests (
  id serial PRIMARY KEY,
  token text UNIQUE NOT NULL,
  booking_id integer REFERENCES bookings(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT '',
  service_category text NOT NULL DEFAULT '',
  testimonial_id integer REFERENCES testimonials(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX feedback_requests_booking_idx ON feedback_requests(booking_id);

INSERT INTO notification_templates(key,audience,subject,body) VALUES
 ('booking_status','customer','Booking {{reference}}: {{status_label}}','Hi {{name}},
{{status_message}}
{{services}} on {{date}} at {{time}}
Total: {{total}}
Paid: {{paid}}
Balance due: {{pending}}
Reference: {{reference}}'),
 ('booking_feedback','customer','How was your experience with {{brand}}?','Hi {{name}},
Thank you for choosing {{brand}} for {{services}}.
We would love your feedback. It takes about a minute:
{{feedback_link}}
Reference: {{reference}}'),
 ('admin_new_feedback','admin','New feedback from {{name}}','{{name}} left a {{rating}} star review:
{{review}}
Approve it in the admin: {{link}}')
ON CONFLICT (key) DO NOTHING
