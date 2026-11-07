import type { TaskStatus } from './statuses';

/*
 * Task transition matrix as data (plan §1, with the owner decisions of 2026-11-08):
 * - a failed task only returns to `assigned`, with a new future deadline;
 * - `hold_until` must be on or before the deadline, and lifting a hold returns
 *   to `previous_status`; review can only be requested from `progress`;
 * - a superadmin reopens completed/cancelled tasks to `assigned` only;
 * - an assignee may ask for a later deadline while the task is assigned, in
 *   progress or failed (D9). The status does not change until the creator or a
 *   superadmin approves (failed → assigned) or declines. One pending request at a time.
 *
 * Actors: A = assignee, C = creator, S = superadmin.
 * `to: 'previous'` resolves to the row's previous_status; `to: 'same'` keeps the
 * status (approving an extension on a failed task revives it to `assigned`).
 * `requires` gates a rule on whether an extension request is pending.
 * Rows marked `reviewed` apply when creator ≠ assignee, `self` when they match.
 */

export type Actor = 'A' | 'C' | 'S';
export type TaskAction =
  | 'start'
  | 'submit'
  | 'complete'
  | 'hold'
  | 'resume'
  | 'approve'
  | 'reject'
  | 'request_cancel'
  | 'approve_cancel'
  | 'decline_cancel'
  | 'withdraw_cancel'
  | 'cancel'
  | 'extend'
  | 'reopen'
  | 'request_extension'
  | 'approve_extension'
  | 'decline_extension'
  | 'withdraw_extension';

export type FieldRule = 'required' | 'optional';

export interface TransitionRule {
  action: TaskAction;
  from: readonly TaskStatus[];
  to: TaskStatus | 'previous' | 'same';
  who: readonly Actor[];
  mode: 'reviewed' | 'self' | 'both';
  /** Input fields. A function lets the rule depend on who is acting. */
  fields?: Record<string, FieldRule> | ((actor: Actor) => Record<string, FieldRule>);
  log: string;
  requires?: 'extension_pending' | 'no_extension';
}

const EXTENDABLE: readonly TaskStatus[] = ['assigned', 'progress', 'failed'];

const OPEN_FOR_CANCEL: readonly TaskStatus[] = ['assigned', 'progress', 'on_hold', 'on_review', 'failed'];

export const TASK_TRANSITIONS: readonly TransitionRule[] = [
  { action: 'start', from: ['assigned'], to: 'progress', who: ['A', 'S'], mode: 'both', log: 'status_changed' },
  { action: 'submit', from: ['progress'], to: 'on_review', who: ['A', 'S'], mode: 'reviewed', log: 'status_changed' },
  {
    action: 'complete',
    from: ['progress'],
    to: 'completed',
    who: ['C', 'S'],
    mode: 'self',
    fields: { completionRemarks: 'optional' },
    log: 'status_changed',
  },
  {
    action: 'hold',
    from: ['assigned', 'progress'],
    to: 'on_hold',
    who: ['A', 'C', 'S'],
    mode: 'both',
    // The assignee must say why; the creator/superadmin may.
    fields: (actor) =>
      actor === 'A' ? { holdReason: 'required', holdUntil: 'required' } : { holdReason: 'optional', holdUntil: 'required' },
    log: 'hold_set',
  },
  { action: 'resume', from: ['on_hold'], to: 'previous', who: ['C', 'S'], mode: 'both', log: 'hold_lifted' },
  {
    action: 'approve',
    from: ['on_review'],
    to: 'completed',
    who: ['C', 'S'],
    mode: 'reviewed',
    fields: { completionRemarks: 'optional' },
    log: 'status_changed',
  },
  {
    action: 'reject',
    from: ['on_review'],
    to: 'assigned',
    who: ['C', 'S'],
    mode: 'reviewed',
    fields: { note: 'optional' },
    log: 'rejected',
  },
  {
    action: 'request_cancel',
    from: ['assigned', 'progress', 'on_hold'],
    to: 'request_cancelation',
    who: ['A'],
    mode: 'reviewed',
    fields: { cancelReason: 'required' },
    log: 'cancel_requested',
  },
  { action: 'approve_cancel', from: ['request_cancelation'], to: 'cancelled', who: ['C', 'S'], mode: 'reviewed', log: 'cancel_approved' },
  {
    action: 'decline_cancel',
    from: ['request_cancelation'],
    to: 'previous',
    who: ['C', 'S'],
    mode: 'reviewed',
    fields: { note: 'optional' },
    log: 'cancel_declined',
  },
  { action: 'withdraw_cancel', from: ['request_cancelation'], to: 'previous', who: ['A'], mode: 'reviewed', log: 'cancel_declined' },
  {
    action: 'cancel',
    from: OPEN_FOR_CANCEL,
    to: 'cancelled',
    who: ['C', 'S'],
    mode: 'both',
    fields: { cancelReason: 'optional' },
    log: 'status_changed',
  },
  {
    action: 'extend',
    from: ['failed'],
    to: 'assigned',
    who: ['C', 'S'],
    mode: 'both',
    fields: { deadline: 'required' },
    // While the assignee has asked for time, approving the request is the way to extend.
    requires: 'no_extension',
    log: 'deadline_extended',
  },
  {
    action: 'reopen',
    from: ['completed', 'cancelled'],
    to: 'assigned',
    who: ['S'],
    mode: 'both',
    // Required only when the old deadline has passed; enforced in the service.
    fields: { deadline: 'optional' },
    log: 'status_changed',
  },
  {
    action: 'request_extension',
    from: EXTENDABLE,
    to: 'same',
    who: ['A'],
    mode: 'reviewed',
    fields: { extensionUntil: 'required', extensionReason: 'required' },
    requires: 'no_extension',
    log: 'extension_requested',
  },
  {
    action: 'approve_extension',
    from: EXTENDABLE,
    to: 'same',
    who: ['C', 'S'],
    mode: 'reviewed',
    // Defaults to the requested date; the approver may pick another.
    fields: { deadline: 'optional', note: 'optional' },
    requires: 'extension_pending',
    log: 'deadline_extended',
  },
  {
    action: 'decline_extension',
    from: EXTENDABLE,
    to: 'same',
    who: ['C', 'S'],
    mode: 'reviewed',
    fields: { note: 'optional' },
    requires: 'extension_pending',
    log: 'extension_declined',
  },
  {
    action: 'withdraw_extension',
    from: EXTENDABLE,
    to: 'same',
    who: ['A'],
    mode: 'reviewed',
    requires: 'extension_pending',
    log: 'extension_withdrawn',
  },
];

export function ruleFor(action: string): TransitionRule | undefined {
  return TASK_TRANSITIONS.find((rule) => rule.action === action);
}

export function fieldsFor(rule: TransitionRule, actor: Actor): Record<string, FieldRule> {
  if (!rule.fields) return {};
  return typeof rule.fields === 'function' ? rule.fields(actor) : rule.fields;
}
