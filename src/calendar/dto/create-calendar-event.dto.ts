import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { calendarEventTypes } from '../../schema/calendar';
export type { CalendarEventType } from '../../schema/calendar';

const trimOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateCalendarEventDto {
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

  @IsEnum(calendarEventTypes)
  type!: (typeof calendarEventTypes)[number];

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  assigneeIds?: string[];
}
