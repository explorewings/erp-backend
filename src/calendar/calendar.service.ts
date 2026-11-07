import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import {
  calendarEvents,
  calendarMeetingMembers,
  users,
  type CalendarEventRow,
  type NewCalendarEventRow,
} from '../schema';
import { CalendarLogService } from './calendar-log.service';
import { CalendarNotifier } from './calendar.notifier';
import { CalendarPolicy, type Viewer } from './calendar.policy';
import { CAN_CREATE, canAssignTask } from './constants/roles';
import { ruleFor } from './constants/task-transitions';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { ListCalendarQueryDto } from './dto/list-calendar-query.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

const MAX_RANGE_DAYS = 62;
const ROW_CAP = 2000;
const DAY_MS = 86_400_000;

/** Fields each type may carry on create (anything else is rejected, plan §8). */
const CREATE_FIELDS: Record<string, string[]> = {
  task: ['title', 'description', 'deadline', 'assigneeId', 'priority'],
  announcement: ['title', 'description', 'startsAt', 'durationMinutes'],
  meeting: ['title', 'description', 'startsAt', 'durationMinutes', 'location', 'visibility', 'memberIds'],
};

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

function fail(status: HttpStatus, code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new HttpException({ statusCode: status, code, message, ...extra }, status);
}
function bad(message: string, code = 'VALIDATION'): never {
  fail(HttpStatus.BAD_REQUEST, code, message);
}
function forbidden(message: string): never {
  fail(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
}
function notFound(): never {
  fail(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Calendar event not found.');
}

function providedKeys(dto: object, ignore: string[]): string[] {
  return Object.entries(dto)
    .filter(([key, value]) => value !== undefined && !ignore.includes(key))
    .map(([key]) => key);
}

function futureDate(value: string, field: string, now = new Date()): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) bad(`${field} must be a valid date.`);
  if (date.getTime() <= now.getTime()) bad(`${field} must be in the future.`);
  return date;
}

@Injectable()
export class CalendarService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly policy: CalendarPolicy,
    private readonly log: CalendarLogService,
    private readonly notifier: CalendarNotifier,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(viewer: Viewer, query: ListCalendarQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from > to) bad('from must be on or before to.');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) bad(`The range can be at most ${MAX_RANGE_DAYS} days.`);

    const e = calendarEvents;
    // Tasks appear on their deadline day only (A2); other types on every day they overlap.
    // An event that ends exactly at `from` (e.g. midnight) does not spill into the range (plan §7).
    const conditions = [
      this.policy.visibleTo(viewer),
      sql`((${e.type} = 'task' AND ${e.endsAt} BETWEEN ${from} AND ${to})
        OR (${e.type} <> 'task' AND ${e.startsAt} <= ${to} AND (${e.endsAt} > ${from} OR ${e.startsAt} >= ${from})))`,
    ];
    if (query.type) conditions.push(sql`${e.type} = ${query.type}`);
    if (query.assigneeId) conditions.push(sql`${e.assigneeId} = ${query.assigneeId}`);
    if (query.search) {
      const term = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conditions.push(sql`(${e.title} ILIKE ${term} OR ${e.description} ILIKE ${term} OR ${e.location} ILIKE ${term})`);
    }

    // A task's place in the day is its deadline; everything else sorts by start.
    const when = sql`CASE WHEN ${e.type} = 'task' THEN ${e.endsAt} ELSE ${e.startsAt} END`;
    const base = this.db.select().from(e).where(and(...conditions)).orderBy(asc(when), asc(e.id));

    if (query.page || query.pageSize) {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const rows = await base.limit(pageSize + 1).offset((page - 1) * pageSize);
      return {
        events: await this.present(rows.slice(0, pageSize), viewer),
        truncated: false,
        page,
        pageSize,
        hasMore: rows.length > pageSize,
      };
    }

    const rows = await base.limit(ROW_CAP + 1);
    return {
      events: await this.present(rows.slice(0, ROW_CAP), viewer),
      truncated: rows.length > ROW_CAP,
    };
  }

  async findOne(viewer: Viewer, id: number) {
    const row = await this.loadVisible(viewer, id);
    const [event] = await this.present([row], viewer);
    return event;
  }

  feed(viewer: Viewer, page = 1) {
    return this.log.feed(viewer, page);
  }

  // --------------------------------------------------------------- create

  async create(viewer: Viewer, dto: CreateCalendarEventDto) {
    if (dto.type === 'followup' && process.env.CALENDAR_FOLLOWUP_ENABLED !== 'true') {
      bad('Follow-ups are not available yet.', 'FOLLOWUP_DISABLED');
    }
    if (!CAN_CREATE[dto.type]?.(viewer.role)) forbidden(`You cannot create this kind of ${dto.type}.`);

    const extra = providedKeys(dto, ['type', ...(CREATE_FIELDS[dto.type] ?? [])]);
    if (extra.length) bad(`Not allowed on a ${dto.type}: ${extra.join(', ')}.`);

    const now = new Date();
    let values: NewCalendarEventRow;

    if (dto.type === 'task') {
      if (!dto.deadline) bad('A task needs a deadline.');
      if (!dto.assigneeId) bad('A task needs an assignee.');
      const deadline = futureDate(dto.deadline, 'The deadline', now);
      await this.assertAssignable(viewer, dto.assigneeId);
      values = {
        type: 'task',
        title: dto.title,
        description: dto.description ?? null,
        status: 'assigned',
        startsAt: now,
        endsAt: deadline,
        priority: dto.priority ?? 'medium',
        assigneeId: dto.assigneeId,
        createdBy: viewer.id,
      };
    } else {
      if (!dto.startsAt) bad('Choose when it starts.');
      if (!dto.durationMinutes) bad('Set how long it lasts.');
      const startsAt = new Date(dto.startsAt);
      const endsAt = new Date(startsAt.getTime() + dto.durationMinutes * 60_000);
      if (dto.type === 'announcement' && !dto.description) bad('An announcement needs its text.');
      if (dto.type === 'meeting') {
        if (!dto.location) bad('A meeting needs a room, address or link.');
        if (!dto.visibility) bad('Choose whether the meeting is open or private.');
      }
      values = {
        type: dto.type,
        title: dto.title,
        description: dto.description ?? null,
        status: 'scheduled',
        startsAt,
        endsAt,
        location: dto.type === 'meeting' ? dto.location ?? null : null,
        visibility: dto.type === 'meeting' ? dto.visibility ?? 'open' : null,
        createdBy: viewer.id,
      };
    }

    const memberIds = dto.type === 'meeting' ? await this.validMembers(dto.memberIds ?? [], viewer.id) : [];

    const id = await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(calendarEvents).values(values).returning({ id: calendarEvents.id });
      if (memberIds.length) {
        await tx.insert(calendarMeetingMembers).values(memberIds.map((userId) => ({ eventId: created.id, userId })));
      }
      await this.log.write(
        { eventId: created.id, actorId: viewer.id, action: 'created', toStatus: values.status },
        tx,
      );
      await this.notifier.created(tx, viewer, { ...values, id: created.id }, memberIds);
      return created.id;
    });
    return this.findOne(viewer, id);
  }

  // --------------------------------------------------------------- update

  async update(viewer: Viewer, id: number, dto: UpdateCalendarEventDto) {
    const row = await this.loadVisible(viewer, id);
    if (row.version !== dto.version) await this.conflict(viewer, row);
    return dto.action ? this.transition(viewer, row, dto) : this.edit(viewer, row, dto);
  }

  private async transition(viewer: Viewer, row: CalendarEventRow, dto: UpdateCalendarEventDto) {
    const action = dto.action as string;
    const now = new Date();
    const inputs = providedKeys(dto, ['version', 'action']);
    const permissions = this.policy.permissions(row, viewer, now);
    const allowed = permissions.actions.find((item) => item.action === action);

    if (!allowed) {
      // Tell apart "you can't" (403) from "that step doesn't exist from here" (400).
      const status = this.policy.effectiveStatus(row, now);
      const rule = row.type === 'task' ? ruleFor(action) : null;
      const gateOk = !rule?.requires || (rule.requires === 'extension_pending') === Boolean(row.extensionUntil);
      if ((rule && gateOk && rule.from.includes(status as never)) || (action === 'cancel_event' && row.type !== 'task')) {
        forbidden('You are not allowed to do that on this event.');
      }
      bad(`"${action}" is not possible while the ${row.type} is ${status}.`, 'INVALID_TRANSITION');
    }

    const notAllowedInputs = inputs.filter((key) => !(key in allowed.fields));
    if (notAllowedInputs.length) bad(`Not accepted for this step: ${notAllowedInputs.join(', ')}.`);
    for (const [field, rule] of Object.entries(allowed.fields)) {
      if (rule === 'required' && !(dto as unknown as Record<string, unknown>)[field]) bad(`${field} is required for this step.`);
    }

    const from = row.status;
    const next: Partial<CalendarEventRow> = { status: allowed.to };
    let logAction = row.type === 'task' ? ruleFor(action)?.log ?? 'status_changed' : 'status_changed';
    let reason: string | null = null;

    switch (action) {
      case 'hold': {
        const holdUntil = futureDate(dto.holdUntil as string, 'Hold until', now);
        if (holdUntil > row.endsAt) {
          bad('A hold must end on or before the deadline. Extend the deadline first if more time is needed.');
        }
        Object.assign(next, { previousStatus: row.status, holdReason: dto.holdReason ?? null, holdUntil });
        reason = dto.holdReason ?? null;
        break;
      }
      case 'resume':
        Object.assign(next, { status: row.previousStatus ?? 'assigned' });
        break;
      case 'complete':
      case 'approve':
        Object.assign(next, { completionRemarks: dto.completionRemarks ?? null });
        reason = dto.completionRemarks ?? null;
        break;
      case 'reject':
        Object.assign(next, { rejectCount: row.rejectCount + 1 });
        reason = dto.note ?? null;
        break;
      case 'request_cancel':
        Object.assign(next, {
          previousStatus: row.status === 'on_hold' ? row.previousStatus ?? 'assigned' : row.status,
          cancelReason: dto.cancelReason,
        });
        reason = dto.cancelReason ?? null;
        break;
      case 'approve_cancel':
        Object.assign(next, { cancelReason: row.cancelReason });
        reason = row.cancelReason;
        break;
      case 'decline_cancel':
      case 'withdraw_cancel':
        Object.assign(next, { status: row.previousStatus ?? 'assigned' });
        reason = dto.note ?? null;
        break;
      case 'cancel':
      case 'cancel_event':
        Object.assign(next, { cancelReason: dto.cancelReason ?? null });
        reason = dto.cancelReason ?? null;
        break;
      case 'extend':
        Object.assign(next, { endsAt: futureDate(dto.deadline as string, 'The new deadline', now) });
        break;
      case 'request_extension': {
        const until = futureDate(dto.extensionUntil as string, 'The proposed deadline', now);
        if (until <= row.endsAt) bad('Propose a deadline later than the current one.');
        Object.assign(next, { extensionUntil: until, extensionReason: dto.extensionReason });
        reason = dto.extensionReason ?? null;
        break;
      }
      case 'approve_extension': {
        const deadline = futureDate(dto.deadline ?? (row.extensionUntil as Date).toISOString(), 'The new deadline', now);
        Object.assign(next, { endsAt: deadline, extensionUntil: null, extensionReason: null });
        reason = dto.note ?? null;
        break;
      }
      case 'decline_extension':
      case 'withdraw_extension':
        Object.assign(next, { extensionUntil: null, extensionReason: null });
        reason = dto.note ?? null;
        break;
      case 'reopen': {
        if (dto.deadline) Object.assign(next, { endsAt: futureDate(dto.deadline, 'The new deadline', now) });
        else if (row.endsAt <= now) bad('The deadline has passed; set a new one to reopen the task.');
        logAction = 'status_changed';
        break;
      }
      default:
        break;
    }

    if (row.type === 'task') this.cleanWorkflowFields(next);
    const members = row.type === 'meeting' ? await this.memberIdsOf(row.id) : [];
    const updated = await this.save(viewer, row, next, {
      action: logAction,
      fromStatus: from,
      toStatus: next.status as string,
      reason,
      meta: {
        step: action,
        ...(next.endsAt ? { deadline: next.endsAt } : {}),
        ...(action === 'request_extension' ? { requestedDeadline: next.extensionUntil } : {}),
      },
    }, null, (tx) => this.notifier.step(tx, viewer, row, action, reason, members));
    return updated;
  }

  /** Reason fields only survive in the status they belong to (plan §1, Phase 1 cleanup). */
  private cleanWorkflowFields(next: Partial<CalendarEventRow>) {
    const status = next.status;
    if (status !== 'on_hold') Object.assign(next, { holdReason: null, holdUntil: null });
    if (status !== 'on_hold' && status !== 'request_cancelation') next.previousStatus = null;
    if (status !== 'request_cancelation' && status !== 'cancelled') next.cancelReason = null;
    if (status !== 'completed') next.completionRemarks = null;
    if (!['assigned', 'progress', 'failed'].includes(status as string) || next.endsAt) {
      if (next.extensionUntil === undefined) Object.assign(next, { extensionUntil: null, extensionReason: null });
    }
  }

  private async edit(viewer: Viewer, row: CalendarEventRow, dto: UpdateCalendarEventDto) {
    const now = new Date();
    const permissions = this.policy.permissions(row, viewer, now);
    const keys = providedKeys(dto, ['version', 'action']);
    if (!keys.length) bad('Nothing to change.');

    if (!permissions.canEdit) {
      if (row.type === 'task' && row.assigneeId === viewer.id && row.createdBy !== viewer.id) {
        bad('Assignees can only move the task through its steps.');
      }
      forbidden('You cannot edit this event in its current state.');
    }
    const outside = keys.filter((key) => !permissions.editableFields.includes(key));
    if (outside.length) bad(`Not editable here: ${outside.join(', ')}.`);

    const next: Partial<CalendarEventRow> = {};
    const changed: string[] = [];
    let logAction = 'updated';
    let toStatus: string | null = null;
    if (dto.title !== undefined) next.title = dto.title;
    if (dto.description !== undefined) next.description = dto.description || null;

    if (row.type === 'task') {
      const effective = this.policy.effectiveStatus(row, now);
      if (dto.priority !== undefined) next.priority = dto.priority;
      if (dto.deadline !== undefined) {
        const deadline = futureDate(dto.deadline, 'The deadline', now);
        if (row.status === 'on_hold' && row.holdUntil && row.holdUntil > deadline) {
          bad('The task is on hold past that date. Shorten the hold or pick a later deadline.');
        }
        next.endsAt = deadline;
        Object.assign(next, { extensionUntil: null, extensionReason: null });
        if (effective === 'failed') {
          Object.assign(next, { status: 'assigned' });
          logAction = 'deadline_extended';
          toStatus = 'assigned';
        }
      }
      if (dto.assigneeId !== undefined && dto.assigneeId !== row.assigneeId) {
        await this.assertAssignable(viewer, dto.assigneeId);
        // Reassigning restarts the workflow for the new person.
        Object.assign(next, {
          assigneeId: dto.assigneeId,
          status: 'assigned',
          rejectCount: 0,
          extensionUntil: null,
          extensionReason: null,
        });
        logAction = 'reassigned';
        toStatus = 'assigned';
      }
      if (next.status) this.cleanWorkflowFields(next);
    } else {
      if (row.type === 'announcement' && dto.description !== undefined && !dto.description) {
        bad('An announcement needs its text.');
      }
      if (row.type === 'meeting' && dto.location !== undefined) {
        if (!dto.location) bad('A meeting needs a room, address or link.');
        next.location = dto.location;
      }
      if (dto.visibility !== undefined) next.visibility = dto.visibility;
      if (dto.startsAt !== undefined || dto.durationMinutes !== undefined) {
        const startsAt = dto.startsAt ? new Date(dto.startsAt) : row.startsAt;
        const minutes = dto.durationMinutes ?? Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
        Object.assign(next, { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) });
      }
    }
    for (const key of keys) changed.push(key);

    const memberIds = dto.memberIds !== undefined ? await this.validMembers(dto.memberIds, row.createdBy) : null;
    const before = memberIds ? new Set(await this.memberIdsOf(row.id)) : new Set<string>();
    const added = (memberIds ?? []).filter((id) => !before.has(id));
    return this.save(
      viewer,
      row,
      next,
      { action: logAction, fromStatus: toStatus ? row.status : null, toStatus, meta: { changed } },
      memberIds,
      (tx) => this.notifier.edited(tx, viewer, row, next, added),
    );
  }

  // --------------------------------------------------------------- delete

  async remove(viewer: Viewer, id: number) {
    const row = await this.loadVisible(viewer, id);
    if (!this.policy.permissions(row, viewer).canDelete) {
      forbidden(row.type === 'task' ? 'Cancel the task before deleting it.' : 'You cannot delete this event.');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(calendarEvents)
        .set({ deletedAt: new Date(), deletedBy: viewer.id, version: row.version + 1, updatedAt: new Date() })
        .where(eq(calendarEvents.id, row.id));
      await this.log.write({ eventId: row.id, actorId: viewer.id, action: 'deleted', fromStatus: row.status }, tx);
    });
    return { id: row.id, deleted: true };
  }

  // -------------------------------------------------------------- helpers

  private async loadVisible(viewer: Viewer, id: number): Promise<CalendarEventRow> {
    const [row] = await this.db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.id, id), this.policy.visibleTo(viewer)))
      .limit(1);
    if (!row) notFound();
    return row;
  }

  private async conflict(viewer: Viewer, row: CalendarEventRow): Promise<never> {
    const [current] = await this.present([row], viewer);
    fail(HttpStatus.CONFLICT, 'VERSION_CONFLICT', 'Someone else changed this event. Review the latest version and try again.', {
      current,
    });
  }

  /** Optimistic write: only succeeds against the version that was read. */
  private async save(
    viewer: Viewer,
    row: CalendarEventRow,
    next: Partial<CalendarEventRow>,
    entry: { action: string; fromStatus?: string | null; toStatus?: string | null; reason?: string | null; meta?: Record<string, unknown> },
    memberIds: string[] | null = null,
    afterWrite?: (tx: Tx) => Promise<unknown>,
  ) {
    const saved = await this.db.transaction(async (tx: Tx) => {
      const result = await tx
        .update(calendarEvents)
        .set({ ...next, version: row.version + 1, updatedAt: new Date() })
        .where(and(eq(calendarEvents.id, row.id), eq(calendarEvents.version, row.version)))
        .returning({ id: calendarEvents.id });
      if (!result.length) return false;
      if (memberIds) {
        await tx.delete(calendarMeetingMembers).where(eq(calendarMeetingMembers.eventId, row.id));
        if (memberIds.length) {
          await tx.insert(calendarMeetingMembers).values(memberIds.map((userId) => ({ eventId: row.id, userId })));
        }
      }
      await this.log.write({ eventId: row.id, actorId: viewer.id, ...entry }, tx);
      // Notifications ride the same transaction: no alert for a change that rolled back.
      if (afterWrite) await afterWrite(tx);
      return true;
    });
    if (!saved) {
      const [latest] = await this.db.select().from(calendarEvents).where(eq(calendarEvents.id, row.id));
      await this.conflict(viewer, latest ?? row);
    }
    return this.findOne(viewer, row.id);
  }

  private async memberIdsOf(eventId: number): Promise<string[]> {
    const rows = await this.db
      .select({ userId: calendarMeetingMembers.userId })
      .from(calendarMeetingMembers)
      .where(eq(calendarMeetingMembers.eventId, eventId));
    return rows.map((r) => r.userId);
  }

  private async assertAssignable(viewer: Viewer, assigneeId: string) {
    const [target] = await this.db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, assigneeId))
      .limit(1);
    if (!target || target.status !== 'active') bad('That person is not an active user.');
    if (!canAssignTask(viewer, target)) forbidden('You cannot assign tasks to that person.');
  }

  private async validMembers(memberIds: string[], creatorId: string): Promise<string[]> {
    const ids = [...new Set(memberIds)].filter((id) => id !== creatorId);
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(inArray(users.id, ids));
    const active = new Set(rows.filter((row) => row.status === 'active').map((row) => row.id));
    if (ids.some((id) => !active.has(id))) bad('One or more invited people are not active users.');
    return ids;
  }

  /** The response shape of plan §6, permissions included. */
  private async present(rows: CalendarEventRow[], viewer: Viewer) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const memberRows = await this.db
      .select({ eventId: calendarMeetingMembers.eventId, userId: calendarMeetingMembers.userId })
      .from(calendarMeetingMembers)
      .where(inArray(calendarMeetingMembers.eventId, ids));

    const userIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.createdBy);
      if (row.assigneeId) userIds.add(row.assigneeId);
    }
    for (const member of memberRows) userIds.add(member.userId);
    const people = new Map(
      (
        await this.db
          .select({ id: users.id, username: users.username, role: users.role })
          .from(users)
          .where(inArray(users.id, [...userIds]))
      ).map((person) => [person.id, person]),
    );
    const person = (id: string | null) => (id ? people.get(id) ?? { id, username: 'Unknown user', role: 'staff' } : null);

    const now = new Date();
    return rows.map((row) => {
      const effectiveStatus = this.policy.effectiveStatus(row, now);
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        status: row.status,
        effectiveStatus,
        label:
          row.type === 'task' && effectiveStatus === 'assigned' && row.rejectCount > 0
            ? `assigned (${row.rejectCount + 1})`
            : effectiveStatus,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        deadline: row.type === 'task' || row.type === 'followup' ? row.endsAt : null,
        location: row.location,
        visibility: row.visibility,
        priority: row.priority,
        imageUrl: row.imageUrl,
        assignee: person(row.assigneeId),
        members: memberRows.filter((member) => member.eventId === row.id).map((member) => person(member.userId)),
        createdBy: person(row.createdBy),
        previousStatus: row.previousStatus,
        holdReason: row.holdReason,
        holdUntil: row.holdUntil,
        cancelReason: row.cancelReason,
        rejectCount: row.rejectCount,
        completionRemarks: row.completionRemarks,
        extensionUntil: row.extensionUntil,
        extensionReason: row.extensionReason,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        permissions: this.policy.permissions(row, viewer, now),
      };
    });
  }
}

