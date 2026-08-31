CREATE INDEX IF NOT EXISTS idx_provider_events_received_at ON provider_events(received_at);
CREATE INDEX IF NOT EXISTS idx_attempts_contact_started_at ON call_attempts(contact_id, started_at);
CREATE INDEX IF NOT EXISTS idx_consents_contact_captured_at ON consents(contact_id, captured_at);
PRAGMA optimize;
