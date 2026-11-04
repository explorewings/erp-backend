import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  controllers: [CalendarController],
  providers: [RolesGuard, CalendarService],
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret-change-me',
      }),
    }),
  ],
  exports: [CalendarService],
})
export class CalendarModule {}
