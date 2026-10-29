import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  controllers: [PackagesController],
  providers: [PackagesService],
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret-change-me',
      }),
    }),
  ],
  exports: [PackagesService],
})
export class PackagesModule {}
