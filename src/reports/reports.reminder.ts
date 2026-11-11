import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Pool, PoolClient } from 'pg';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { reportSettings } from '../schema';
import { formatDueTime, formatReportDate, timeToMinutes, zonedNow } from './report-time';

const INTERVAL_MS = 5 * 60_000;
const LOCK_KEY = 814506245; // one reminder run across all API instances
const KIND = 'report_missing';

/**
 * Every 5 minutes: once today's due time (Reports timezone) has passed, remind
 * each staff/admin with Reports access who has not submitted a report for today.
 *
 * - No due time set, or today is an off day (settings.skip_days) → nothing is sent.
 * - Each person gets at most one reminder per date: an existing `report_missing`
 *   notification for that user and date blocks a repeat, so restarts and
 *   multiple instances are safe, and a reminder missed during downtime is still
 *   sent later the same day.
 * - Superadmin/superuser are not reminded; they review rather than submit.
 */
@Injectable()
export class ReportsReminder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportsReminder.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly pool: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.REPORTS_REMINDER === 'off') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    setTimeout(() => void this.run(), 15_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()) {
    if (this.running) return;
    this.running = true;
    let client: PoolClient | null = null;
    try {
      const [settings] = await this.db.select().from(reportSettings).where(eq(reportSettings.id, 1)).limit(1);
      if (!settings?.dueTime) return;
      const today = zonedNow(now);
      if (settings.skipDays.includes(today.weekday)) return;
      if (today.minutes < timeToMinutes(settings.dueTime)) return;

      client = await this.pool.connect();
      const { rows: lock } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
      if (!lock[0]?.locked) return;
      try {
        const { rows } = await client.query<{ id: string }>(
          `SELECT u.id
             FROM users u
            WHERE u.status = 'active'
              AND u.role IN ('staff', 'admin')
              -- Same rule as AccessService.hasMenuAccess: an active menu item plus an explicit allow.
              AND EXISTS (SELECT 1 FROM access_items i
                           WHERE i.code = 'menu:reports' AND i.type = 'menu' AND i.is_active)
              AND EXISTS (SELECT 1 FROM access a
                           WHERE a.user_id = u.id AND a.code = 'menu:reports' AND a.allowed)
              AND NOT EXISTS (SELECT 1 FROM reports r
                               WHERE r.created_by = u.id AND r.report_date = $1::date)
              AND NOT EXISTS (SELECT 1 FROM notifications n
                               WHERE n.user_id = u.id AND n.kind = $2 AND n.entity_id = $3)`,
          // The date goes in twice: once typed as a date, once as the text notification entity id.
          [today.date, KIND, today.date],
        );
        if (!rows.length) return;
        const sent = await this.notifications.notify({
          recipients: rows.map((row) => row.id),
          actorId: null,
          module: 'reports',
          kind: KIND,
          entityType: 'report_date',
          entityId: today.date,
          title: `Daily report not submitted for ${formatReportDate(today.date)}`,
          body: `Your report was due at ${formatDueTime(settings.dueTime)}. Submit it now.`,
          link: '/erp/reports?new=1',
        });
        this.logger.log(`Reports reminder: ${sent} people reminded for ${today.date}.`);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      }
    } catch (error) {
      this.logger.error(`Reports reminder failed: ${(error as Error).message}`);
    } finally {
      client?.release();
      this.running = false;
    }
  }
}
