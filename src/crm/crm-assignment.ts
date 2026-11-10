export const CRM_DEAL_ASSIGNMENT_METHODS = [
  'round_robin',
  'creator_manual',
  'least_loaded',
] as const;

export type CrmDealAssignmentMethod = (typeof CRM_DEAL_ASSIGNMENT_METHODS)[number];
