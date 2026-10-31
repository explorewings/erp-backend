import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CheckUserAvailabilityDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsEmail()
  email!: string;
}
