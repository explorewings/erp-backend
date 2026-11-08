import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { calendarEventLog, calendarEvents, users } from '../schema';
import { CalendarPolicy, type Viewer } from './calendar.policy';

export interface LogEntry {
  eventId: number;
  actorId: string | null;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Audit trail and the Updates feed (plan §5 calendar_event_log). Notifications come later. */
@Injectable()
export class CalendarLogService {
  static readonly PAGE_SIZE = 20;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly policy: CalendarPolicy,
  ) {}

  /** Write inside the caller's transaction when one is given. */
  async write(entry: LogEntry, tx: Pick<DrizzleDb, 'insert'> = this.db) {
    await tx.insert(calendarEventLog).values({
      eventId: entry.eventId,
      actorId: entry.actorId,
      action: entry.action,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      reason: entry.reason ?? null,
      meta: entry.meta ?? null,
    });
  }

  /** Newest first, only for events the viewer can see. */
  async feed(viewer: Viewer, page = 1) {
    const actor = alias(users, 'actor');
    const size = CalendarLogService.PAGE_SIZE;
    const rows = await this.db
      .select({
        id: calendarEventLog.id,
        action: calendarEventLog.action,
        fromStatus: calendarEventLog.fromStatus,
        toStatus: calendarEventLog.toStatus,
        reason: calendarEventLog.reason,
        createdAt: calendarEventLog.createdAt,
        actorId: actor.id,
        actorName: actor.username,
        eventId: calendarEvents.id,
        eventType: calendarEvents.type,
        eventTitle: calendarEvents.title,
      })
      .from(calendarEventLog)
      .innerJoin(calendarEvents, eq(calendarEventLog.eventId, calendarEvents.id))
      .leftJoin(actor, eq(calendarEventLog.actorId, actor.id))
      .where(and(this.policy.visibleTo(viewer)))
      .orderBy(desc(calendarEventLog.createdAt), desc(calendarEventLog.id))
      .limit(size + 1)
      .offset((page - 1) * size);

    return {
      page,
      hasMore: rows.length > size,
      items: rows.slice(0, size).map((row) => ({
        id: row.id,
        action: row.action,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        reason: row.reason,
        createdAt: row.createdAt,
        actor: row.actorId ? { id: row.actorId, username: row.actorName } : null,
        event: { id: row.eventId, type: row.eventType, title: row.eventTitle },
      })),
    };
  }

  /** Full trail of one event, newest first. The caller must have already checked visibility. */
  async forEvent(eventId: number, page = 1) {
    const actor = alias(users, 'actor');
    const size = CalendarLogService.PAGE_SIZE;
    const rows = await this.db
      .select({
        id: calendarEventLog.id,
        action: calendarEventLog.action,
        fromStatus: calendarEventLog.fromStatus,
        toStatus: calendarEventLog.toStatus,
        reason: calendarEventLog.reason,
        meta: calendarEventLog.meta,
        createdAt: calendarEventLog.createdAt,
        actorId: actor.id,
        actorName: actor.username,
      })
      .from(calendarEventLog)
      .leftJoin(actor, eq(calendarEventLog.actorId, actor.id))
      .where(eq(calendarEventLog.eventId, eventId))
      .orderBy(desc(calendarEventLog.createdAt), desc(calendarEventLog.id))
      .limit(size + 1)
      .offset((page - 1) * size);
    return {
      page,
      hasMore: rows.length > size,
      items: rows.slice(0, size).map((row) => ({
        id: row.id,
        action: row.action,
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
        reason: row.reason,
        meta: row.meta,
        createdAt: row.createdAt,
        actor: row.actorId ? { id: row.actorId, username: row.actorName } : null,
      })),
    };
  }
}
