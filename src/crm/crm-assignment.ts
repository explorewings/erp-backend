// Type-only module: imported by schema/crm.ts, so it must not import services
// (that would create a schema <-> service import cycle).

/**
 * How new deals in a pipeline get an owner:
 * - round_robin: the next eligible user in turn (persisted cursor)
 * - single_user: always the pipeline's chosen user (deal_assignment_user_id)
 * - creator: the person who adds the deal to the pipeline
 * - manual: nobody; owners are picked by hand from the deal drawer
 */
export const CRM_DEAL_ASSIGNMENT_METHODS = [
  'round_robin',
  'single_user',
  'creator',
  'manual',
] as const;

export type CrmDealAssignmentMethod = (typeof CRM_DEAL_ASSIGNMENT_METHODS)[number];

/** Rules that can bulk-assign the pipeline's unassigned deals. */
export const CRM_DISTRIBUTABLE_METHODS = ['round_robin', 'single_user'] as const;

/** Deals assigned per distribute call; the UI loops until none remain. */
export const CRM_DISTRIBUTE_CHUNK_SIZE = 100;
