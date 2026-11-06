import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, between, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database.module';
import {
  calendarAssignees,
  calendarEvents,
  users,
  type CalendarEventRow,
  type CalendarEventType,
} from '../schema';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

const EVENT_TYPES: CalendarEventType[] = ['task', 'announcement', 'meeting'];

type AuthUser = { id?: string };

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date.`);
  }
  return d;
}

@Injectable()
export class CalendarService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(query: {
    from?: string;
    to?: string;
    type?: string;
    assigneeId?: string;
    search?: string;
    viewer?: AuthUser;
  }) {
    if (query.assigneeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.assigneeId)) {
      throw new BadRequestException('assigneeId must be a valid UUID.');
    }
    if (query.type && !EVENT_TYPES.includes(query.type as CalendarEventType)) {
      throw new BadRequestException(`type must be one of: ${EVENT_TYPES.join(', ')}.`);
    }

    const from = parseDate(query.from, 'from');
    const to = parseDate(query.to, 'to');
    if (from && to && from > to) {
      throw new BadRequestException('from must be on or before to.');
    }

    const viewerId = query.viewer?.id;
    const viewerRole = (query.viewer as { role?: string })?.role;
    const isPrivileged = viewerRole === 'superadmin';

    const conditions: ReturnType<typeof sql>[] = [];
    if (!isPrivileged && viewerId) {
      conditions.push(
        sql`(${calendarEvents.type} = 'announcement' OR ${calendarEvents.createdBy} = ${viewerId} OR EXISTS (SELECT 1 FROM ${calendarAssignees} WHERE ${calendarAssignees.eventId} = ${calendarEvents.id} AND ${calendarAssignees.userId} = ${viewerId}))`,
      );
    }
    if (from) conditions.push(sql`${calendarEvents.endsAt} >= ${from}`);
    if (to) conditions.push(sql`${calendarEvents.startsAt} <= ${to}`);
    if (query.type) {
      conditions.push(sql`${calendarEvents.type} = ${query.type}`);
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push(
        sql`(${calendarEvents.title} ILIKE ${term} OR ${calendarEvents.description} ILIKE ${term} OR ${calendarEvents.location} ILIKE ${term})`,
      );
    }
    if (query.assigneeId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${calendarAssignees} WHERE ${calendarAssignees.eventId} = ${calendarEvents.id} AND ${calendarAssignees.userId} = ${query.assigneeId})`,
      );
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(calendarEvents)
      .where(whereClause)
      .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id));

    return this.attachAssignees(rows);
  }

  async findOne(id: number) {
    const [row] = await this.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Calendar event ${id} not found.`);
    const [event] = await this.attachAssignees([row]);
    return event;
  }

  async create(dto: CreateCalendarEventDto, actor: AuthUser) {    const startsAt = parseDate(dto.startsAt, 'startsAt');
    if (!startsAt) throw new BadRequestException('startsAt is required.');
    const endsAt = parseDate(dto.endsAt, 'endsAt');
    if (endsAt && endsAt < startsAt) {
      throw new BadRequestException('endsAt must be on or after startsAt.');
    }

    const assigneeIds = await this.validateAssignees(dto.assigneeIds ?? []);

    const [created] = await this.db
      .insert(calendarEvents)
      .values({
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        type: dto.type,
        startsAt,
        endsAt: endsAt ?? null,
        location: dto.location?.trim() || null,
        createdBy: actor?.id ?? null,
      })
      .returning();
    if (!created) throw new Error('Unable to create calendar event.');
    if (assigneeIds.length) {
      await this.db
        .insert(calendarAssignees)
        .values(assigneeIds.map((userId) => ({ eventId: created.id, userId })));
    }
    return this.findOne(created.id);
  }

  async update(id: number, dto: UpdateCalendarEventDto, actor: AuthUser) {
    const existing = await this.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .limit(1)
      .then((rows) => rows[0]);
    if (!existing) throw new NotFoundException(`Calendar event ${id} not found.`);

    const actorId = actor?.id;
    const actorRole = (actor as { role?: string })?.role;
    if (actorRole !== 'superadmin') {
      const isCreator = actorId && existing.createdBy === actorId;
      if (!isCreator) {
        // Check if actor is assignee
        const isAssignee = actorId
          ? await this.db
              .select({ eventId: calendarAssignees.eventId })
              .from(calendarAssignees)
              .where(
                and(
                  eq(calendarAssignees.eventId, id),
                  eq(calendarAssignees.userId, actorId),
                ),
              )
              .then((rows) => rows.length > 0)
          : false;
        if (!isAssignee) {
          throw new BadRequestException(
            'Only the creator or assigned staff can update this calendar event.',
          );
        }
        // Assignee: strip non-status fields
        const { title, description, type, startsAt, endsAt, location, assigneeIds, ..._rest } = dto as any;
        // Keep only status/reason fields if present in future DTO; currently DTO has none,
        // so assignee update becomes no-op unless we add those fields.
        // For now, reject field changes other than updatedAt.
        if (title !== undefined || description !== undefined || type !== undefined || startsAt !== undefined || endsAt !== undefined || location !== undefined || assigneeIds !== undefined) {
          throw new BadRequestException(
            'Assigned staff can only update status and reason fields.',
          );
        }
      }
    }

    const nextStartsAt =
      dto.startsAt !== undefined ? parseDate(dto.startsAt, 'startsAt') : existing.startsAt;
    const nextEndsAt =
      dto.endsAt !== undefined ? parseDate(dto.endsAt, 'endsAt') : existing.endsAt;
    if (nextEndsAt && nextStartsAt && nextEndsAt < nextStartsAt) {
      throw new BadRequestException('endsAt must be on or after startsAt.');
    }

    const updates: Partial<CalendarEventRow> = {
      updatedAt: new Date(),
    };
    if (dto.title !== undefined) updates.title = dto.title.trim();
    if (dto.description !== undefined) updates.description = dto.description?.trim() || null;
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.startsAt !== undefined) updates.startsAt = nextStartsAt;
    if (dto.endsAt !== undefined) updates.endsAt = nextEndsAt ?? null;
    if (dto.location !== undefined) updates.location = dto.location?.trim() || null;

    await this.db.update(calendarEvents).set(updates).where(eq(calendarEvents.id, id));

    if (dto.assigneeIds !== undefined) {
      const assigneeIds = await this.validateAssignees(dto.assigneeIds);
      await this.db.delete(calendarAssignees).where(eq(calendarAssignees.eventId, id));
      if (assigneeIds.length) {
        await this.db
          .insert(calendarAssignees)
          .values(assigneeIds.map((userId) => ({ eventId: id, userId })));
      }
    }

    return this.findOne(id);
  }

  async remove(id: number, actor: AuthUser) {
    const existing = await this.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .limit(1)
      .then((rows) => rows[0]);
    if (!existing) throw new NotFoundException(`Calendar event ${id} not found.`);

    const actorId = actor?.id;
    const actorRole = (actor as { role?: string })?.role;
    if (actorRole !== 'superadmin') {
      const isCreator = actorId && existing.createdBy === actorId;
      if (!isCreator) {
        throw new BadRequestException('Only the creator or superadmin can delete this calendar event.');
      }
    }

    const [deleted] = await this.db
      .delete(calendarEvents)
      .where(eq(calendarEvents.id, id))
      .returning({ id: calendarEvents.id });
    if (!deleted) throw new NotFoundException(`Calendar event ${id} not found.`);
    return deleted;
  }

  private async validateAssignees(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const unique = [...new Set(userIds)];
    const rows = await this.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(inArray(users.id, unique));
    const active = new Set(rows.filter((r) => r.status === 'active').map((r) => r.id));
    const invalid = unique.filter((id) => !active.has(id));
    if (invalid.length) {
      throw new BadRequestException('One or more assignees are invalid or inactive.');
    }
    return unique;
  }

  private async attachAssignees(rows: CalendarEventRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const links = await this.db
      .select({
        eventId: calendarAssignees.eventId,
        userId: calendarAssignees.userId,
        username: users.username,
        email: users.email,
        role: users.role,
      })
      .from(calendarAssignees)
      .innerJoin(users, eq(calendarAssignees.userId, users.id))
      .where(inArray(calendarAssignees.eventId, ids));

    const byEvent = new Map<number, typeof links>();
    for (const link of links) {
      const list = byEvent.get(link.eventId) ?? [];
      list.push(link);
      byEvent.set(link.eventId, list);
    }

    return rows.map((row) => ({
      ...row,
      assignees: (byEvent.get(row.id) ?? []).map(({ userId, username, email, role }) => ({
        userId,
        username,
        email,
        role,
      })),
    }));
  }
}
