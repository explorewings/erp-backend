import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateResortDto {
  @IsString()
  location!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  ratings?: number;
}
