import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { users } from './users';
import type { CrmDealAssignmentMethod } from '../crm/crm-assignment';

export const crmPipelines = pgTable(
  'crm_pipelines',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    dealAssignmentMethod: text('deal_assignment_method')
      .$type<CrmDealAssignmentMethod>()
      .notNull()
      .default('creator'),
    roundRobinCursor: integer('round_robin_cursor').notNull().default(0),
    /** The user who receives every deal under the 'single_user' rule. */
    dealAssignmentUserId: uuid('deal_assignment_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    check('crm_pipelines_name_not_empty', sql`BTRIM(${table.name}) <> ''`),
    check('crm_pipelines_position_nonnegative', sql`${table.position} >= 0`),
    check(
      'crm_pipelines_deal_assignment_method_valid',
      sql`${table.dealAssignmentMethod} IN ('round_robin', 'single_user', 'creator', 'manual')`,
    ),
    check('crm_pipelines_round_robin_cursor_nonnegative', sql`${table.roundRobinCursor} >= 0`),
    index('crm_pipelines_position_idx').on(table.position, table.id),
    index('crm_pipelines_deal_assignment_user_id_idx').on(table.dealAssignmentUserId),
  ],
);

export const crmPipelineStages = pgTable(
  'crm_pipeline_stages',
  {
    id: serial('id').primaryKey(),
    pipelineId: integer('pipeline_id')
      .notNull()
      .references(() => crmPipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('crm_pipeline_stages_name_not_empty', sql`BTRIM(${table.name}) <> ''`),
    check('crm_pipeline_stages_position_nonnegative', sql`${table.position} >= 0`),
    unique('crm_pipeline_stages_pipeline_id_id_unique').on(table.pipelineId, table.id),
    unique('crm_pipeline_stages_pipeline_name_unique').on(table.pipelineId, table.name),
    index('crm_pipeline_stages_pipeline_position_idx').on(table.pipelineId, table.position),
  ],
);

export const crmPipelineUsers = pgTable(
  'crm_pipeline_users',
  {
    pipelineId: integer('pipeline_id')
      .notNull()
      .references(() => crmPipelines.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'crm_pipeline_users_pkey', columns: [table.pipelineId, table.userId] }),
    index('crm_pipeline_users_user_id_idx').on(table.userId),
  ],
);

export const crmDeals = pgTable(
  'crm_deals',
  {
    id: serial('id').primaryKey(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    pipelineId: integer('pipeline_id')
      .notNull()
      .references(() => crmPipelines.id, { onDelete: 'restrict' }),
    stageId: integer('stage_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'crm_deals_pipeline_stage_fk',
      columns: [table.pipelineId, table.stageId],
      foreignColumns: [crmPipelineStages.pipelineId, crmPipelineStages.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'crm_deals_pipeline_assignee_fk',
      columns: [table.pipelineId, table.assignedUserId],
      foreignColumns: [crmPipelineUsers.pipelineId, crmPipelineUsers.userId],
    }).onDelete('restrict'),
    unique('crm_deals_pipeline_client_unique').on(table.pipelineId, table.clientId),
    index('crm_deals_client_id_idx').on(table.clientId),
    index('crm_deals_created_by_idx').on(table.createdBy),
    index('crm_deals_pipeline_stage_idx').on(table.pipelineId, table.stageId),
    index('crm_deals_pipeline_assigned_user_idx').on(table.pipelineId, table.assignedUserId),
    index('crm_deals_pipeline_unassigned_idx')
      .on(table.pipelineId, table.createdAt, table.id)
      .where(sql`${table.assignedUserId} IS NULL`),
  ],
);


export type CrmPipelineRow = typeof crmPipelines.$inferSelect;
export type NewCrmPipelineRow = typeof crmPipelines.$inferInsert;
export type CrmPipelineStageRow = typeof crmPipelineStages.$inferSelect;
export type CrmPipelineUserRow = typeof crmPipelineUsers.$inferSelect;
export type NewCrmPipelineStageRow = typeof crmPipelineStages.$inferInsert;
export type CrmDealRow = typeof crmDeals.$inferSelect;
export type NewCrmDealRow = typeof crmDeals.$inferInsert;
