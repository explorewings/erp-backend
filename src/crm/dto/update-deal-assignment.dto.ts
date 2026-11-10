import { IsIn } from 'class-validator';
import { CRM_DEAL_ASSIGNMENT_METHODS } from '../crm-assignment';
import type { CrmDealAssignmentMethod } from '../crm-assignment';

export class UpdateCrmDealAssignmentDto {
  @IsIn(CRM_DEAL_ASSIGNMENT_METHODS)
  method!: CrmDealAssignmentMethod;
}
