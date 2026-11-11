/**
 * Reports runs on one business timezone, so "today", the due time and the
 * skipped weekdays mean the same thing for every user and for the server.
 */
export const REPORTS_TIMEZONE = process.env.REPORTS_TIMEZONE || 'Asia/Kolkata';

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORTS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface ZonedNow {
  /** `YYYY-MM-DD` in the Reports timezone. */
  date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

export function zonedNow(now = new Date()): ZonedNow {
  const parts = Object.fromEntries(partsFormat.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** `HH:MM` or `HH:MM:SS` → minutes since midnight. */
export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** `18:00` → `6:00 PM`. */
export function formatDueTime(value: string): string {
  const [hours, minutes] = value.split(':').map(Number);
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** `2026-11-12` → `12 Nov 2026` (no timezone shift: it is a plain date). */
export function formatReportDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[month - 1]} ${year}`;
}
