import { IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsEmail()
  email!: string;

  @IsIn(['admin', 'staff'])
  role!: 'admin' | 'staff';

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accessCodes?: string[];
}
