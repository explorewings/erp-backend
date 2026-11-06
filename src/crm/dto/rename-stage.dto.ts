import { IsString, MaxLength } from 'class-validator';

export class RenameCrmStageDto {
  @IsString()
  @MaxLength(100)
  name!: string;
}
