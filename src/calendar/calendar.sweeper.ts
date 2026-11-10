import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { calendarEvents, calendarMeetingMembers, notifications } from '../schema';
import { CalendarLogService } from './calendar-log.service';
import { CalendarNotifier } from './calendar.notifier';
import { FAILABLE_TASK_STATUSES } from './constants/statuses';

const INTERVAL_MS = 5 * 60_000;
const LOCK_KEY = 814506244; // one sweeper across all running API instances

/**
 * Every 5 minutes (plan §1.2, A5):
 * 1. expired holds return to their previous status;
 * 2. assigned/progress tasks past their deadline are stored as `failed`;
 * 3. meetings that have just started are announced once ("live").
 * Holds run first, so a hold that ended after the deadline fails in the same pass.
 * Uses the same predicate as read-time derivation (isTaskFailed) in SQL form.
 */
@Injectable()
export class CalendarSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalendarSweeper.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly pool: Pool,
    private readonly log: CalendarLogService,
    private readonly notifier: CalendarNotifier,
  ) {}

  onModuleInit() {
    if (process.env.CALENDAR_SWEEPER === 'off') return;
    this.timer = setInterval(() => void this.sweep(), INTERVAL_MS);
    setTimeout(() => void this.sweep(), 10_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()) {
    if (this.running) return;
    this.running = true;
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
      if (!rows[0]?.locked) return;
      try {
        const lifted = await this.liftExpiredHolds(now);
        const failed = await this.failOverdue(now);
        const live = await this.announceLiveMeetings(now);
        if (lifted || failed || live) {
          this.logger.log(
            `Calendar sweep: ${lifted} holds lifted, ${failed} tasks failed, ${live} meetings went live.`,
          );
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      }
    } catch (error) {
      this.logger.error(`Calendar sweep failed: ${(error as Error).message}`);
    } finally {
      client.release();
      this.running = false;
    }
  }

  private async liftExpiredHolds(now: Date) {
    const e = calendarEvents;
    const due = await this.db
      .select()
      .from(e)
      .where(and(eq(e.type, 'task'), eq(e.status, 'on_hold'), lte(e.holdUntil, now), isNull(e.deletedAt)));
    for (const row of due) {
      const to = row.previousStatus ?? 'assigned';
      await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(e)
          .set({ status: to, previousStatus: null, holdReason: null, holdUntil: null, version: row.version + 1, updatedAt: now })
          .where(and(eq(e.id, row.id), eq(e.version, row.version)))
          .returning({ id: e.id });
        if (updated.length) {
          await this.log.write(
            { eventId: row.id, actorId: null, action: 'hold_lifted', fromStatus: 'on_hold', toStatus: to, meta: { system: true } },
            tx,
          );
        }
      });
    }
    return due.length;
  }

  /**
   * Meetings whose start has passed but whose end has not: announce each one
   * once. `live` is derived from the time window (meetings store only
   * scheduled|cancelled), so de-duplication looks for an existing
   * `meeting_live` notification row for that event.
   */
  private async announceLiveMeetings(now: Date) {
    const e = calendarEvents;
    const live = await this.db
      .select({ id: e.id, type: e.type, title: e.title, visibility: e.visibility, createdBy: e.createdBy })
      .from(e)
      .where(
        and(
          eq(e.type, 'meeting'),
          eq(e.status, 'scheduled'),
          lte(e.startsAt, now),
          gt(e.endsAt, now),
          isNull(e.deletedAt),
        ),
      );
    if (!live.length) return 0;

    const already = await this.db
      .select({ entityId: notifications.entityId })
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, 'meeting_live'),
          inArray(
            notifications.entityId,
            live.map((row) => String(row.id)),
          ),
        ),
      );
    const announced = new Set(already.map((row) => row.entityId));

    let sent = 0;
    for (const row of live) {
      if (announced.has(String(row.id))) continue;
      const members = await this.db
        .select({ userId: calendarMeetingMembers.userId })
        .from(calendarMeetingMembers)
        .where(eq(calendarMeetingMembers.eventId, row.id));
      await this.db.transaction(async (tx) => {
        await this.notifier.meetingLive(tx, row, members.map((m) => m.userId));
      });
      sent += 1;
    }
    return sent;
  }

  private async failOverdue(now: Date) {    const e = calendarEvents;
    return this.db.transaction(async (tx) => {
      const failed = await tx
        .update(e)
        .set({ status: 'failed', version: sql`${e.version} + 1`, updatedAt: now })
        .where(
          and(
            eq(e.type, 'task'),
            inArray(e.status, [...FAILABLE_TASK_STATUSES]),
            lt(e.endsAt, now),
            isNull(e.deletedAt),
          ),
        )
        .returning({ id: e.id, title: e.title, createdBy: e.createdBy, assigneeId: e.assigneeId });
      for (const row of failed) {
        await this.log.write(
          { eventId: row.id, actorId: null, action: 'failed_auto', toStatus: 'failed', meta: { system: true } },
          tx,
        );
        await this.notifier.failed(tx, row);
      }
      return failed.length;
    });
  }
}
