import { IsEmail, IsString, MinLength, IsIn, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsIn(['estudiante', 'docente'])
  role!: 'estudiante' | 'docente';

  @IsString()
  schoolCode!: string;

  @IsString()
  sectionCode!: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
