import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';

/** move = the same deal row re-points; copy = a new deal in the target. */
export const CRM_TRANSFER_MODES = ['move', 'copy'] as const;

/** One chunk of a bulk transfer; the client sends 1–100 deal ids per call. */
export class TransferCrmDealsDto {
  @IsIn(CRM_TRANSFER_MODES)
  mode!: (typeof CRM_TRANSFER_MODES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  dealIds!: number[];

  @IsInt()
  @IsPositive()
  targetPipelineId!: number;

  /** Defaults to the target pipeline's first stage. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetStageId?: number;
}
