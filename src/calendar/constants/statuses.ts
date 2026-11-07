/* Stored statuses per event type (docs/calendar-plan.md §1–§4). */

export const TASK_STATUSES = [
  'assigned',
  'progress',
  'on_review',
  'completed',
  'on_hold',
  'request_cancelation',
  'cancelled',
  'failed',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Announcements and meetings store only these; upcoming/live/ended are derived from time. */
export const SCHEDULED_STATUSES = ['scheduled', 'cancelled'] as const;
export type TimeBoxStatus = 'upcoming' | 'live' | 'ended' | 'cancelled';

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const MEETING_VISIBILITIES = ['open', 'private'] as const;

/** Statuses a task never leaves without a superadmin reopening it. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'cancelled'];

/** Statuses the creator/assignee may still edit core fields in. */
export const EDITABLE_TASK_STATUSES: readonly TaskStatus[] = ['assigned', 'progress', 'on_hold', 'failed'];

/** Only these statuses can fail when the deadline passes (on_review / request_cancelation wait on the creator). */
export const FAILABLE_TASK_STATUSES: readonly TaskStatus[] = ['assigned', 'progress'];

/** The single `failed` predicate (plan §1.2). Used for read-time derivation, SQL and the sweeper. */
export function isTaskFailed(task: { status: string; endsAt: Date | string }, now = new Date()): boolean {
  return (
    (FAILABLE_TASK_STATUSES as readonly string[]).includes(task.status) &&
    new Date(task.endsAt).getTime() < now.getTime()
  );
}

export function deriveTimeBoxStatus(
  event: { status: string; startsAt: Date | string; endsAt: Date | string },
  now = new Date(),
): TimeBoxStatus {
  if (event.status === 'cancelled') return 'cancelled';
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  const t = now.getTime();
  if (t < start) return 'upcoming';
  if (t <= end) return 'live';
  return 'ended';
}
