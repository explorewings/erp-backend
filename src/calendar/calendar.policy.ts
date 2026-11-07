import { Injectable } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import { calendarEvents, calendarMeetingMembers, type CalendarEventRow } from '../schema';
import { isAdmin, isSuper } from './constants/roles';
import {
  EDITABLE_TASK_STATUSES,
  deriveTimeBoxStatus,
  isTaskFailed,
  type TaskStatus,
} from './constants/statuses';
import { TASK_TRANSITIONS, fieldsFor, type Actor, type FieldRule } from './constants/task-transitions';

export interface Viewer {
  id: string;
  role: string;
}

export interface PermissionAction {
  action: string;
  to: string;
  fields: Record<string, FieldRule>;
}

export interface Permissions {
  canEdit: boolean;
  canDelete: boolean;
  canReassign: boolean;
  editableFields: string[];
  actions: PermissionAction[];
  allowedStatuses: string[];
  requiredFieldsByStatus: Record<string, string[]>;
}

/**
 * Every calendar rule lives here (plan §7 "CalendarPolicy"): who sees what,
 * who may do what. The service asks; the controller never decides.
 */
@Injectable()
export class CalendarPolicy {
  /** The ONE visibility predicate (plan §0). Applied to list, findOne, mutations, filters and the feed. */
  visibleTo(viewer: Viewer): SQL {
    const e = calendarEvents;
    const isMember = sql`EXISTS (SELECT 1 FROM ${calendarMeetingMembers} m WHERE m.event_id = ${e.id} AND m.user_id = ${viewer.id})`;
    const meeting = sql`(${e.type} = 'meeting' AND (${e.visibility} = 'open' OR ${e.createdBy} = ${viewer.id} OR ${isMember}))`;
    if (isSuper(viewer.role)) {
      return sql`(${e.deletedAt} IS NULL AND (${e.type} IN ('task', 'followup', 'announcement') OR ${meeting}))`;
    }
    return sql`(${e.deletedAt} IS NULL AND (
      ${e.createdBy} = ${viewer.id}
      OR (${e.type} IN ('task', 'followup') AND ${e.assigneeId} = ${viewer.id})
      OR ${e.type} = 'announcement'
      OR ${meeting}
    ))`;
  }

  effectiveStatus(row: CalendarEventRow, now = new Date()): string {
    if (row.type === 'task') return isTaskFailed(row, now) ? 'failed' : row.status;
    if (row.type === 'followup') return row.status;
    return deriveTimeBoxStatus(row, now);
  }

  taskActors(row: CalendarEventRow, viewer: Viewer): Set<Actor> {
    const actors = new Set<Actor>();
    if (row.assigneeId === viewer.id) actors.add('A');
    if (row.createdBy === viewer.id) actors.add('C');
    if (isSuper(viewer.role)) actors.add('S');
    return actors;
  }

  /** Which field rules apply: a pure assignee is held to the stricter assignee rules. */
  fieldActor(actors: Set<Actor>): Actor {
    return actors.has('A') && !actors.has('C') && !actors.has('S') ? 'A' : 'C';
  }

  taskActions(row: CalendarEventRow, viewer: Viewer, now = new Date()): PermissionAction[] {
    const status = this.effectiveStatus(row, now) as TaskStatus;
    const actors = this.taskActors(row, viewer);
    if (!actors.size) return [];
    const selfAssigned = row.createdBy === row.assigneeId;
    const fieldActor = this.fieldActor(actors);
    const pending = Boolean(row.extensionUntil);
    return TASK_TRANSITIONS.filter(
      (rule) =>
        rule.from.includes(status) &&
        (!rule.requires || (rule.requires === 'extension_pending') === pending) &&
        (rule.mode === 'both' || rule.mode === (selfAssigned ? 'self' : 'reviewed')) &&
        rule.who.some((who) => actors.has(who)),
    ).map((rule) => ({
      action: rule.action,
      to:
        rule.to === 'previous'
          ? row.previousStatus ?? 'assigned'
          : rule.to === 'same'
            ? rule.action === 'approve_extension' && status === 'failed'
              ? 'assigned'
              : status
            : rule.to,
      fields: fieldsFor(rule, fieldActor),
    }));
  }

  /** Manage rights for announcements and meetings (plan §2, §3, A9). */
  canManageTimeBox(row: CalendarEventRow, viewer: Viewer): boolean {
    if (row.createdBy === viewer.id) return true;
    if (row.type === 'announcement') return isSuper(viewer.role) || isAdmin(viewer.role);
    if (row.type === 'meeting') return row.visibility === 'open' && (isSuper(viewer.role) || isAdmin(viewer.role));
    return false;
  }

  permissions(row: CalendarEventRow, viewer: Viewer, now = new Date()): Permissions {
    let result: Omit<Permissions, 'allowedStatuses' | 'requiredFieldsByStatus'>;

    if (row.type === 'task') {
      const status = this.effectiveStatus(row, now) as TaskStatus;
      const owner = row.createdBy === viewer.id || isSuper(viewer.role);
      const editable = owner && EDITABLE_TASK_STATUSES.includes(status);
      result = {
        canEdit: editable,
        canReassign: editable,
        canDelete: isSuper(viewer.role) || (row.createdBy === viewer.id && (status === 'assigned' || status === 'cancelled')),
        editableFields: editable ? ['title', 'description', 'deadline', 'priority', 'assigneeId'] : [],
        actions: this.taskActions(row, viewer, now),
      };
    } else {
      const manage = this.canManageTimeBox(row, viewer);
      const active = ['upcoming', 'live'].includes(this.effectiveStatus(row, now));
      const fields =
        row.type === 'meeting'
          ? ['title', 'description', 'startsAt', 'durationMinutes', 'location', 'visibility', 'memberIds']
          : ['title', 'description', 'startsAt', 'durationMinutes'];
      result = {
        canEdit: manage && active,
        canReassign: false,
        canDelete: manage,
        editableFields: manage && active ? fields : [],
        actions: manage && active ? [{ action: 'cancel_event', to: 'cancelled', fields: {} }] : [],
      };
    }

    const requiredFieldsByStatus: Record<string, string[]> = {};
    for (const item of result.actions) {
      const required = Object.entries(item.fields)
        .filter(([, rule]) => rule === 'required')
        .map(([name]) => name);
      if (required.length) requiredFieldsByStatus[item.to] = required;
    }
    return {
      ...result,
      allowedStatuses: [...new Set(result.actions.map((item) => item.to))],
      requiredFieldsByStatus,
    };
  }
}
