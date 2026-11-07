import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarPolicy } from './calendar.policy';
import { CalendarLogService } from './calendar-log.service';
import { CalendarSweeper } from './calendar.sweeper';
import { CalendarNotifier } from './calendar.notifier';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  controllers: [CalendarController],
  providers: [RolesGuard, CalendarPolicy, CalendarLogService, CalendarNotifier, CalendarService, CalendarSweeper],
  imports: [
    NotificationsModule,
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
