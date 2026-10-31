import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StorageModule } from '../storage/storage.module';
import { ResortsController } from './resorts.controller';
import { ResortsService } from './resorts.service';

@Module({
  controllers: [ResortsController],
  providers: [RolesGuard, ResortsService],
  imports: [
    StorageModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret-change-me',
      }),
    }),
  ],
  exports: [ResortsService],
})
export class ResortsModule {}
