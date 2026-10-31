import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateResortDto {
  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  description?: string;

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
