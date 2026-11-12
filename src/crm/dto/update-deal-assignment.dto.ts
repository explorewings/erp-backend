import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { CRM_DEAL_ASSIGNMENT_METHODS } from '../crm-assignment';
import type { CrmDealAssignmentMethod } from '../crm-assignment';

export class UpdateCrmDealAssignmentDto {
  @IsIn(CRM_DEAL_ASSIGNMENT_METHODS)
  method!: CrmDealAssignmentMethod;

  /** Required for 'single_user': the user who receives every deal. Ignored otherwise. */
  @ValidateIf((dto: UpdateCrmDealAssignmentDto) => dto.method === 'single_user')
  @IsUUID()
  @IsOptional()
  userId?: string;
}
