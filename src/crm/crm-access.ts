import type { AuthUser } from '../auth/auth.service';

export type CrmUser = AuthUser;

export function isSuperRole(role: string): boolean {
  return role === 'superadmin' || role === 'superuser';
}

/**
 * Who may see (and work inside) a pipeline:
 * superadmin/superuser, the pipeline's creator, or a user granted access.
 */
export function canViewPipeline(
  user: CrmUser,
  pipeline: { createdBy: string | null },
  hasGrant: boolean,
): boolean {
  return isSuperRole(user.role) || pipeline.createdBy === user.id || hasGrant;
}

/**
 * Who may rename or delete a pipeline:
 * superadmin/superuser (any pipeline), the creator, or an admin with access.
 * Staff never can, even with access.
 */
export function canManagePipeline(
  user: CrmUser,
  pipeline: { createdBy: string | null },
  hasGrant: boolean,
): boolean {
  if (isSuperRole(user.role) || pipeline.createdBy === user.id) return true;
  return user.role === 'admin' && hasGrant;
}
