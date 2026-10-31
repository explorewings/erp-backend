import { IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

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
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message: 'Password must include uppercase and lowercase letters, a number, and a special character.',
  })
  password!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accessCodes?: string[];
}
