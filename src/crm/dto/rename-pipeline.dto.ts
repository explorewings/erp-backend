import { IsString, MaxLength } from 'class-validator';

export class RenameCrmPipelineDto {
  @IsString()
  @MaxLength(100)
  name!: string;
}
