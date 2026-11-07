import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE, DrizzleDb } from '../database.module';
import { notifications, users } from '../schema';

export interface NotifyInput {
  /** Who should see it. The actor, duplicates and empty ids are dropped. */
  recipients: Array<string | null | undefined>;
  actorId: string | null;
  module: string;
  kind: string;
  entityType?: string;
  entityId?: string | number;
  title: string;
  body?: string | null;
  /** In-app path to open, e.g. /erp/calendar?event=12 */
  link?: string | null;
  meta?: Record<string, unknown> | null;
}

type Writer = Pick<DrizzleDb, 'insert'>;

/**
 * Shared notification store. Any module calls `notify()` (ideally inside its own
 * transaction, so a rolled-back change never leaves a stray alert); the header
 * bell reads through the controller.
 */
@Injectable()
export class NotificationsService {
  static readonly PAGE_SIZE = 50;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async notify(input: NotifyInput, tx: Writer = this.db) {
    const recipients = [...new Set(input.recipients.filter((id): id is string => Boolean(id)))].filter(
      (id) => id !== input.actorId,
    );
    if (!recipients.length) return 0;
    await tx.insert(notifications).values(
      recipients.map((userId) => ({
        userId,
        actorId: input.actorId,
        module: input.module,
        kind: input.kind,
        entityType: input.entityType ?? null,
        entityId: input.entityId === undefined ? null : String(input.entityId),
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        meta: input.meta ?? null,
      })),
    );
    return recipients.length;
  }

  /** Every active user, for broadcasts such as announcements. */
  async activeUserIds(): Promise<string[]> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.status, 'active'));
    return rows.map((row) => row.id);
  }

  async list(userId: string, page = 1) {
    const size = NotificationsService.PAGE_SIZE;
    const actor = alias(users, 'actor');
    const rows = await this.db
      .select({
        id: notifications.id,
        module: notifications.module,
        kind: notifications.kind,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorId: actor.id,
        actorName: actor.username,
      })
      .from(notifications)
      .leftJoin(actor, eq(notifications.actorId, actor.id))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(size + 1)
      .offset((page - 1) * size);

    return {
      page,
      hasMore: rows.length > size,
      unread: await this.unreadCount(userId),
      items: rows.slice(0, size).map(({ actorId, actorName, ...row }) => ({
        ...row,
        actor: actorId ? { id: actorId, username: actorName } : null,
      })),
    };
  }

  async unreadCount(userId: string) {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(row?.value ?? 0);
  }

  /** Mark the given ids (or everything) read for this user only. */
  async markRead(userId: string, ids?: number[]) {
    const scope = [eq(notifications.userId, userId), isNull(notifications.readAt)];
    if (ids?.length) scope.push(inArray(notifications.id, ids));
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(...scope));
    return { unread: await this.unreadCount(userId) };
  }
}
