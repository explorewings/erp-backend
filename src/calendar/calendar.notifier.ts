import { Injectable } from '@nestjs/common';
import type { CalendarEventRow, NewCalendarEventRow } from '../schema';
import { NotificationsService } from '../notifications/notifications.service';
import type { Viewer } from './calendar.policy';

type Writer = Parameters<NotificationsService['notify']>[1];
type Audience = 'creator' | 'assignee' | 'both';

interface StepMessage {
  audience: Audience;
  title: string;
  body: (actor: string, title: string, reason?: string | null) => string;
}

const q = (title: string) => `“${title}”`;
const withReason = (text: string, reason?: string | null) => (reason ? `${text}: ${reason}` : `${text}.`);

/**
 * Who hears about each task step (decisions 2026-11-08, full workflow).
 * The actor is never notified about their own action.
 */
const TASK_STEPS: Record<string, StepMessage> = {
  submit: { audience: 'creator', title: 'Review requested', body: (a, t) => `${a} submitted ${q(t)} for review.` },
  approve: { audience: 'assignee', title: 'Task approved', body: (a, t, r) => withReason(`${a} approved ${q(t)}`, r) },
  reject: { audience: 'assignee', title: 'Task sent back', body: (a, t, r) => withReason(`${a} sent ${q(t)} back`, r) },
  hold: { audience: 'both', title: 'Task on hold', body: (a, t, r) => withReason(`${a} put ${q(t)} on hold`, r) },
  resume: { audience: 'both', title: 'Hold lifted', body: (a, t) => `${a} lifted the hold on ${q(t)}.` },
  request_cancel: { audience: 'creator', title: 'Cancellation requested', body: (a, t, r) => withReason(`${a} asked to cancel ${q(t)}`, r) },
  approve_cancel: { audience: 'assignee', title: 'Cancellation approved', body: (a, t) => `${a} approved cancelling ${q(t)}.` },
  decline_cancel: { audience: 'assignee', title: 'Cancellation declined', body: (a, t, r) => withReason(`${a} declined cancelling ${q(t)}`, r) },
  withdraw_cancel: { audience: 'creator', title: 'Cancellation withdrawn', body: (a, t) => `${a} withdrew the request to cancel ${q(t)}.` },
  cancel: { audience: 'both', title: 'Task cancelled', body: (a, t, r) => withReason(`${a} cancelled ${q(t)}`, r) },
  extend: { audience: 'both', title: 'Deadline extended', body: (a, t) => `${a} gave ${q(t)} a new deadline.` },
  reopen: { audience: 'both', title: 'Task reopened', body: (a, t) => `${a} reopened ${q(t)}.` },
  request_extension: { audience: 'creator', title: 'More time requested', body: (a, t, r) => withReason(`${a} asked for more time on ${q(t)}`, r) },
  approve_extension: { audience: 'assignee', title: 'More time approved', body: (a, t) => `${a} approved a new deadline for ${q(t)}.` },
  decline_extension: { audience: 'assignee', title: 'More time declined', body: (a, t, r) => withReason(`${a} declined more time on ${q(t)}`, r) },
  withdraw_extension: { audience: 'creator', title: 'More-time request withdrawn', body: (a, t) => `${a} withdrew the request for more time on ${q(t)}.` },
};

/** Turns calendar changes into notifications. Every call runs inside the caller's transaction. */
@Injectable()
export class CalendarNotifier {
  constructor(private readonly notifications: NotificationsService) {}

  private base(event: { id: number; type: string }, actorId: string | null, kind: string) {
    return {
      actorId,
      module: 'calendar',
      kind,
      entityType: 'calendar_event',
      entityId: event.id,
      link: `/erp/calendar?event=${event.id}`,
    };
  }

  private name(viewer: Viewer) {
    return viewer.username || 'Someone';
  }

  async created(tx: Writer, viewer: Viewer, event: NewCalendarEventRow & { id: number }, memberIds: string[]) {
    const actor = this.name(viewer);
    if (event.type === 'task') {
      await this.notifications.notify(
        { ...this.base(event, viewer.id, 'task_assigned'), recipients: [event.assigneeId], title: 'New task assigned', body: `${actor} assigned you ${q(event.title)}.` },
        tx,
      );
    } else if (event.type === 'meeting') {
      // Open meetings are visible to everyone, so everyone hears about them; private ones reach invitees only.
      if (event.visibility === 'open') {
        await this.notifications.notify(
          {
            ...this.base(event, viewer.id, 'meeting_scheduled'),
            recipients: await this.notifications.activeUserIds(),
            title: 'New meeting',
            body: `${actor} scheduled ${q(event.title)}.`,
          },
          tx,
        );
      } else {
        await this.invited(tx, viewer, event, memberIds);
      }
    } else if (event.type === 'announcement') {
      await this.notifications.notify(
        {
          ...this.base(event, viewer.id, 'announcement_posted'),
          recipients: await this.notifications.activeUserIds(),
          title: 'New announcement',
          body: `${actor} posted ${q(event.title)}.`,
        },
        tx,
      );
    }
  }

  async invited(tx: Writer, viewer: Viewer, event: { id: number; type: string; title: string }, memberIds: string[]) {
    if (!memberIds.length) return;
    await this.notifications.notify(
      { ...this.base(event, viewer.id, 'meeting_invited'), recipients: memberIds, title: 'Meeting invitation', body: `${this.name(viewer)} invited you to ${q(event.title)}.` },
      tx,
    );
  }

  /**
   * A meeting has just started ("live"). Fired once per meeting by the sweeper
   * when `starts_at <= now < ends_at`; the caller de-duplicates against the
   * notification rows already written for this entity. Open meetings reach
   * everyone, private ones only the invitees and the creator.
   */
  async meetingLive(
    tx: Writer,
    row: { id: number; type: string; title: string; visibility: string | null; createdBy: string },
    memberIds: string[],
  ) {
    await this.notifications.notify(
      {
        ...this.base(row, null, 'meeting_live'),
        recipients: row.visibility === 'open' ? await this.notifications.activeUserIds() : [...memberIds, row.createdBy],
        title: 'Meeting is live',
        body: `${q(row.title)} has started.`,
      },
      tx,
    );
  }

  /** A workflow step on a task, or cancelling a meeting. */
  async step(tx: Writer, viewer: Viewer, row: CalendarEventRow, action: string, reason: string | null, memberIds: string[] = []) {
    if (row.type === 'meeting' && action === 'cancel_event') {
      await this.notifications.notify(
        {
          ...this.base(row, viewer.id, 'meeting_cancelled'),
          recipients: row.visibility === 'open' ? await this.notifications.activeUserIds() : [...memberIds, row.createdBy],
          title: 'Meeting cancelled',
          body: withReason(`${this.name(viewer)} cancelled ${q(row.title)}`, reason),
        },
        tx,
      );
      return;
    }
    const message = row.type === 'task' ? TASK_STEPS[action] : undefined;
    if (!message) return;
    const recipients =
      message.audience === 'creator' ? [row.createdBy] : message.audience === 'assignee' ? [row.assigneeId] : [row.createdBy, row.assigneeId];
    await this.notifications.notify(
      { ...this.base(row, viewer.id, `task_${action}`), recipients, title: message.title, body: message.body(this.name(viewer), row.title, reason) },
      tx,
    );
  }

  /** Edits that matter to someone else: a new assignee, a moved deadline, new meeting invitees. */
  async edited(
    tx: Writer,
    viewer: Viewer,
    row: CalendarEventRow,
    next: Partial<CalendarEventRow>,
    addedMembers: string[],
  ) {
    const actor = this.name(viewer);
    const title = next.title ?? row.title;
    if (row.type === 'task') {
      if (next.assigneeId && next.assigneeId !== row.assigneeId) {
        await this.notifications.notify(
          { ...this.base(row, viewer.id, 'task_assigned'), recipients: [next.assigneeId], title: 'New task assigned', body: `${actor} assigned you ${q(title)}.` },
          tx,
        );
      } else if (next.endsAt && row.endsAt && next.endsAt.getTime() !== row.endsAt.getTime()) {
        await this.notifications.notify(
          { ...this.base(row, viewer.id, 'task_deadline_changed'), recipients: [row.assigneeId], title: 'Deadline changed', body: `${actor} changed the deadline of ${q(title)}.` },
          tx,
        );
      }
    }
    if (row.type === 'meeting') {
      const visibility = next.visibility ?? row.visibility;
      if (visibility === 'private' && addedMembers.length) {
        await this.invited(tx, viewer, { ...row, title }, addedMembers);
      } else if (row.visibility === 'private' && visibility === 'open') {
        // A private meeting opened up: now everyone can see it.
        await this.notifications.notify(
          {
            ...this.base(row, viewer.id, 'meeting_scheduled'),
            recipients: await this.notifications.activeUserIds(),
            title: 'New meeting',
            body: `${actor} opened ${q(title)} to everyone.`,
          },
          tx,
        );
      }
    }
  }

  /** The sweeper marked a task failed. No actor. */
  async failed(tx: Writer, row: { id: number; title: string; createdBy: string; assigneeId: string | null }) {
    await this.notifications.notify(
      {
        ...this.base({ id: row.id, type: 'task' }, null, 'task_failed'),
        recipients: [row.createdBy, row.assigneeId],
        title: 'Task failed',
        body: `${q(row.title)} passed its deadline.`,
      },
      tx,
    );
  }
}
