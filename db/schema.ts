import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
};

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), externalId: text('external_id').notNull().unique(), email: text('email').notNull(), displayName: text('display_name').notNull(),
  availability: text('availability', { enum: ['available', 'busy', 'offline'] }).notNull().default('offline'), ...timestamps,
});

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), name: text('name').notNull(), phoneE164: text('phone_e164').notNull(),
  phoneOriginalEncrypted: text('phone_original_encrypted'), source: text('source').notNull(), doNotCall: integer('do_not_call', { mode: 'boolean' }).notNull().default(false), ...timestamps,
}, (table) => [index('idx_contacts_owner_phone').on(table.ownerId, table.phoneE164)]);

export const consents = sqliteTable('consents', {
  id: text('id').primaryKey(), contactId: text('contact_id').notNull().references(() => contacts.id), legalBasis: text('legal_basis').notNull(), source: text('source').notNull(),
  capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull(), expiresAt: integer('expires_at', { mode: 'timestamp_ms' }), evidenceEncrypted: text('evidence_encrypted'), ...timestamps,
});

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => users.id), name: text('name').notNull(),
  status: text('status', { enum: ['draft', 'running', 'paused', 'stopped', 'completed'] }).notNull(), concurrency: integer('concurrency').notNull().default(3),
  idempotencyKey: text('idempotency_key').notNull().unique(), ...timestamps,
});

export const dialRounds = sqliteTable('dial_rounds', {
  id: text('id').primaryKey(), campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  status: text('status', { enum: ['starting', 'dialing', 'winner_locked', 'completed', 'cancelled'] }).notNull(), winnerAttemptId: text('winner_attempt_id'),
  idempotencyKey: text('idempotency_key').notNull().unique(), startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(), completedAt: integer('completed_at', { mode: 'timestamp_ms' }), ...timestamps,
}, (table) => [index('idx_rounds_campaign_status').on(table.campaignId, table.status)]);

export const callAttempts = sqliteTable('call_attempts', {
  id: text('id').primaryKey(), roundId: text('round_id').notNull().references(() => dialRounds.id), contactId: text('contact_id').notNull().references(() => contacts.id),
  provider: text('provider').notNull(), providerCallId: text('provider_call_id'), status: text('status').notNull(), classification: text('classification'), errorCode: text('error_code'),
  version: integer('version').notNull().default(0), startedAt: integer('started_at', { mode: 'timestamp_ms' }), answeredAt: integer('answered_at', { mode: 'timestamp_ms' }),
  connectedAt: integer('connected_at', { mode: 'timestamp_ms' }), endedAt: integer('ended_at', { mode: 'timestamp_ms' }), ...timestamps,
}, (table) => [index('idx_attempts_round_status').on(table.roundId, table.status), uniqueIndex('uq_attempts_provider_call').on(table.provider, table.providerCallId)]);

export const providerEvents = sqliteTable('provider_events', {
  id: text('id').primaryKey(), provider: text('provider').notNull(), externalEventId: text('external_event_id').notNull(), attemptId: text('attempt_id').references(() => callAttempts.id),
  eventType: text('event_type').notNull(), payloadHash: text('payload_hash').notNull(), occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(), processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
}, (table) => [uniqueIndex('uq_provider_events_external').on(table.provider, table.externalEventId)]);

export const callResults = sqliteTable('call_results', {
  id: text('id').primaryKey(), attemptId: text('attempt_id').notNull().references(() => callAttempts.id).unique(), ownerId: text('owner_id').notNull().references(() => users.id),
  outcome: text('outcome', { enum: ['interested', 'callback', 'sale', 'not_interested', 'invalid_number'] }).notNull(), notesEncrypted: text('notes_encrypted'),
  doNotCall: integer('do_not_call', { mode: 'boolean' }).notNull().default(false), ...timestamps,
});

export const blocklist = sqliteTable('blocklist', {
  id: text('id').primaryKey(), phoneHash: text('phone_hash').notNull().unique(), reason: text('reason').notNull(), source: text('source').notNull(),
  blockedAt: integer('blocked_at', { mode: 'timestamp_ms' }).notNull(), expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(), actorId: text('actor_id'), action: text('action').notNull(), entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
  correlationId: text('correlation_id').notNull(), metadataRedacted: text('metadata_redacted').notNull(), createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('idx_audit_entity_created').on(table.entityType, table.entityId, table.createdAt)]);

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), windowStartedAt: integer('window_started_at', { mode: 'timestamp_ms' }).notNull(), count: integer('count').notNull(),
});
