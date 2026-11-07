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
import { MEETING_VISIBILITIES, TASK_PRIORITIES } from '../constants/statuses';
import { MAX_DURATION_MINUTES, trimOrUndefined } from './create-calendar-event.dto';

/**
 * PATCH body. Either an edit (plain fields) or a workflow step (`action` plus
 * that action's fields) — never both. `version` is always required (409 on mismatch).
 */
export class UpdateCalendarEventDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  action?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  /** null clears it. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

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

  // Workflow fields.
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  holdReason?: string;

  @IsOptional()
  @IsDateString()
  holdUntil?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  cancelReason?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  completionRemarks?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @IsOptional()
  @IsDateString()
  extensionUntil?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  extensionReason?: string;
}
