import { IsInt, IsPositive } from 'class-validator';

export class MoveCrmDealDto {
  @IsInt()
  @IsPositive()
  stageId!: number;
}
