import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateReportRemarksDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  remarks?: string | null;
}
