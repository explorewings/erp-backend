import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Board search: matches client name, email or phone (case-insensitive). */
export class CrmBoardQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Next page of one stage's deals. */
export class CrmStageDealsQueryDto extends CrmBoardQueryDto {
  /** Opaque cursor from the previous page's `nextCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

/** Every deal id in the given stages (Deal transfer selects by stage). */
export class CrmDealIdsQueryDto {
  @Transform(({ value }) =>
    ([] as unknown[])
      .concat(value ?? [])
      .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
      .filter((part) => part !== '')
      .map((part) => Number(part)),
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  stageIds!: number[];
}
