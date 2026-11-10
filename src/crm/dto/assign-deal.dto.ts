import { IsUUID, ValidateIf } from 'class-validator';

export class AssignCrmDealDto {
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  assignedUserId!: string | null;
}
