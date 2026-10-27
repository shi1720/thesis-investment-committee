import { integer, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const researchRuns = sqliteTable('research_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: text('created_at').notNull(),
  status: text('status').notNull(),
  profile: text('profile').notNull(),
  result: text('result'),
  error: text('error'),
  idempotencyKey: text('idempotency_key').notNull(),
}, table => [index('runs_user_created').on(table.userId, table.createdAt), uniqueIndex('runs_user_idempotency').on(table.userId, table.idempotencyKey)]);

export const savedTheses = sqliteTable('saved_theses', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), symbol: text('symbol').notNull(),
  name: text('name').notNull(), market: text('market').notNull(), runId: text('run_id').notNull(),
  createdAt: text('created_at').notNull(), invalidation: text('invalidation').notNull(), note: text('note').notNull().default(''),
}, table => [index('theses_user_created').on(table.userId, table.createdAt), uniqueIndex('theses_user_symbol_market').on(table.userId, table.symbol, table.market)]);

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(), windowStart: integer('window_start').notNull(), count: integer('count').notNull(),
});

export const committeeMemories = sqliteTable('committee_memories', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), runId: text('run_id').notNull(),
  createdAt: text('created_at').notNull(), payload: text('payload').notNull(),
}, table => [index('memories_user_created').on(table.userId, table.createdAt)]);

export const memoryAuditArchives = sqliteTable('memory_audit_archives', {
  id:text('id').primaryKey(), userId:text('user_id').notNull(),runId:text('run_id').notNull(),
  createdAt:text('created_at').notNull(),payload:text('payload').notNull(),
},table=>[index('memory_archives_user_created').on(table.userId,table.createdAt)]);
