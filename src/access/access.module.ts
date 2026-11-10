import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { MenuAccessGuard } from './menu-access.guard';

@Global()
@Module({
  controllers: [AccessController],
  providers: [RolesGuard, AccessService, MenuAccessGuard],
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret-change-me',
      }),
    }),
  ],
  exports: [AccessService, MenuAccessGuard],
})
export class AccessModule {}
