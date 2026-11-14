import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { CRM_DEAL_ASSIGNMENT_METHODS, CrmDealAssignmentMethod } from '../crm-assignment';

/** Which assignments to undo: deals whose current owner was assigned this way. */
export class UnassignCrmDealsBySourceDto {
  @IsIn(CRM_DEAL_ASSIGNMENT_METHODS)
  source!: CrmDealAssignmentMethod;

  /** Only this owner's deals (e.g. one user's single-user deals). */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
