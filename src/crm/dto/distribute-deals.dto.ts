import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { CRM_DISTRIBUTABLE_METHODS } from '../crm-assignment';

/**
 * A one-off bulk assignment of the pipeline's unassigned deals. Independent of
 * the pipeline's rule for new deals.
 */
export class DistributeCrmDealsDto {
  /** round_robin = share equally among eligible users; single_user = all to `userId`. */
  @IsIn(CRM_DISTRIBUTABLE_METHODS)
  method!: (typeof CRM_DISTRIBUTABLE_METHODS)[number];

  @ValidateIf((dto: DistributeCrmDealsDto) => dto.method === 'single_user')
  @IsUUID()
  @IsOptional()
  userId?: string;
}
