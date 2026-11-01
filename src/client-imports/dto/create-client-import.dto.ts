import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateClientImportDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  totalRows!: number;
}
