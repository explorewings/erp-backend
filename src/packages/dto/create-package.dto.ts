import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class CreatePackageDto {
  @IsString()
  location!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  ratings?: number;
}
