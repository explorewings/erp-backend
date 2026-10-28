import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SettingsController } from './settings.controller';
import { UsersModule } from '../users/users.module';

@Module({
  controllers: [SettingsController],
  providers: [RolesGuard],
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret-change-me',
      }),
    }),
  ],
})
export class SettingsModule {}
