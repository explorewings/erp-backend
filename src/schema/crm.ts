import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';

export const crmPipelines = pgTable(
  'crm_pipelines',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('crm_pipelines_name_not_empty', sql`BTRIM(${table.name}) <> ''`),
    check('crm_pipelines_position_nonnegative', sql`${table.position} >= 0`),
    index('crm_pipelines_position_idx').on(table.position, table.id),
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
    uniqueIndex('crm_pipeline_stages_pipeline_id_id_unique_idx').on(table.pipelineId, table.id),
    uniqueIndex('crm_pipeline_stages_pipeline_name_unique_idx').on(table.pipelineId, table.name),
    index('crm_pipeline_stages_pipeline_position_idx').on(table.pipelineId, table.position),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'crm_deals_pipeline_stage_fk',
      columns: [table.pipelineId, table.stageId],
      foreignColumns: [crmPipelineStages.pipelineId, crmPipelineStages.id],
    }).onDelete('restrict'),
    uniqueIndex('crm_deals_pipeline_client_unique_idx').on(table.pipelineId, table.clientId),
    index('crm_deals_client_id_idx').on(table.clientId),
    index('crm_deals_pipeline_stage_idx').on(table.pipelineId, table.stageId),
  ],
);

export type CrmPipelineRow = typeof crmPipelines.$inferSelect;
export type NewCrmPipelineRow = typeof crmPipelines.$inferInsert;
export type CrmPipelineStageRow = typeof crmPipelineStages.$inferSelect;
export type NewCrmPipelineStageRow = typeof crmPipelineStages.$inferInsert;
export type CrmDealRow = typeof crmDeals.$inferSelect;
export type NewCrmDealRow = typeof crmDeals.$inferInsert;
