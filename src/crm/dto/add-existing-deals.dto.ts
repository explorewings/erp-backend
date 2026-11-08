import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsPositive } from 'class-validator';

export class AddExistingCrmDealsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  clientIds!: number[];
}
