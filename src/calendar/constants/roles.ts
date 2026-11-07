/* Role groups. The users table stores 'staff' for staff; the plan also calls them 'user'. */

export type RoleGroup = 'superadmin' | 'admin' | 'staff';

export function roleGroup(role: string | null | undefined): RoleGroup {
  if (role === 'superadmin' || role === 'superuser') return 'superadmin';
  if (role === 'admin') return 'admin';
  return 'staff';
}

export const isSuper = (role?: string | null) => roleGroup(role) === 'superadmin';
export const isAdmin = (role?: string | null) => roleGroup(role) === 'admin';

/**
 * Task assignment (plan §0, A1): everyone may self-assign; superadmin → any
 * non-superadmin; admin → staff only; staff → self only. Nobody assigns to a
 * superadmin other than that superadmin themself.
 */
export function canAssignTask(
  actor: { id: string; role: string },
  target: { id: string; role: string },
): boolean {
  if (actor.id === target.id) return true;
  if (isSuper(target.role)) return false;
  const group = roleGroup(actor.role);
  if (group === 'superadmin') return true;
  if (group === 'admin') return roleGroup(target.role) === 'staff';
  return false;
}

export const CAN_CREATE: Record<string, (role: string) => boolean> = {
  task: () => true,
  meeting: () => true,
  announcement: (role) => isSuper(role) || isAdmin(role),
  followup: () => true,
};
