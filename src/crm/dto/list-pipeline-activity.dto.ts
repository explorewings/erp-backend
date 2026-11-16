import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CRM_PIPELINE_ACTIVITY_ACTIONS, CrmPipelineActivityAction } from '../../schema';

export class ListCrmPipelineActivityDto {
  /** Opaque cursor from the previous page's `nextCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** One action or a comma-separated list, e.g. `rule_changed,rule_auto_changed`. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' || Array.isArray(value)
      ? ([] as unknown[])
          .concat(value)
          .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
          .map((part) => (typeof part === 'string' ? part.trim() : part))
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(CRM_PIPELINE_ACTIVITY_ACTIONS.length)
  @IsIn(CRM_PIPELINE_ACTIVITY_ACTIONS, { each: true })
  action?: CrmPipelineActivityAction[];
}
