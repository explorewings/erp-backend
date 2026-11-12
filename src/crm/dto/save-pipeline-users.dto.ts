import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** The full desired member list of a pipeline (the creator is always kept). */
export class PreviewCrmPipelineUsersDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class SaveCrmPipelineUsersDto extends PreviewCrmPipelineUsersDto {
  /** Must be true when removed users own deals; those deals become unassigned. */
  @IsOptional()
  @IsBoolean()
  confirmUnassign?: boolean;
}
