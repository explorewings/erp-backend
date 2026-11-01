import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientsModule } from '../clients/clients.module';
import { ClientImportsController } from './client-imports.controller';
import { ClientImportsService } from './client-imports.service';

@Module({
  imports: [
    ClientsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret-change-me',
      }),
    }),
  ],
  controllers: [ClientImportsController],
  providers: [RolesGuard, ClientImportsService],
})
export class ClientImportsModule {}
