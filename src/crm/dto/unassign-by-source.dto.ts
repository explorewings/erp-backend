import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { CRM_DEAL_ASSIGNMENT_METHODS, CrmDealAssignmentMethod } from '../crm-assignment';

/** Which assignments to undo: deals whose current owner was assigned this way. */
export class UnassignCrmDealsBySourceDto {
  /** Omitted with `userId` = all of that user's deals, however they were assigned. */
  @ValidateIf((dto: UnassignCrmDealsBySourceDto) => !dto.userId || dto.source != null)
  @IsIn(CRM_DEAL_ASSIGNMENT_METHODS)
  source?: CrmDealAssignmentMethod;

  /** Only this owner's deals (e.g. one user's single-user deals). */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Same id on every chunk of one run, so the history shows the run as one entry. */
  @IsOptional()
  @IsUUID()
  runId?: string;
}
