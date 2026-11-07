import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { calendarEventTypes } from '../../schema/calendar';
import { MEETING_VISIBILITIES, TASK_PRIORITIES } from '../constants/statuses';

export const trimOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** 62 days: the longest span an announcement or meeting may run. */
export const MAX_DURATION_MINUTES = 62 * 24 * 60;

/**
 * One DTO for every type; the service checks which fields each type requires
 * and rejects fields that do not belong to it (plan §8).
 */
export class CreateCalendarEventDto {
  @IsIn(calendarEventTypes)
  type!: (typeof calendarEventTypes)[number];

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Task: the deadline (stored as ends_at). */
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  /** Announcement / meeting. */
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_MINUTES)
  durationMinutes?: number;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location?: string;

  @IsOptional()
  @IsIn(MEETING_VISIBILITIES)
  visibility?: (typeof MEETING_VISIBILITIES)[number];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIds?: string[];
}
