import { IsUUID } from 'class-validator';

export class AddCrmPipelineUserDto {
  @IsUUID()
  userId!: string;
}
