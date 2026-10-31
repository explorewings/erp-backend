import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const trimOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateClientDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phoneNumber?: string;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}
