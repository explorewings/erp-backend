import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const parseReportItems = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export class CreateReportDto {
  @IsDateString()
  reportDate!: string;

  @Transform(parseReportItems)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  reports!: string[];

  @IsIn(['none', 'url', 'file'])
  attachmentMode!: 'none' | 'url' | 'file';

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @MinLength(1)
  attachmentUrl?: string;
}
