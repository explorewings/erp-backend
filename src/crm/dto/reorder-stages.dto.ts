import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsPositive } from 'class-validator';

export class ReorderCrmStagesDto {
  /** Every stage ID of the pipeline, in the desired order. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  stageIds!: number[];
}
