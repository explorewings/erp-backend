import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientsModule } from '../clients/clients.module';
import { CrmAssignmentController } from './crm-assignment.controller';
import { CrmAssignmentService } from './crm-assignment.service';
import { CrmDealsController } from './crm-deals.controller';
import { CrmDealsService } from './crm-deals.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

@Module({
  controllers: [CrmController, CrmDealsController, CrmAssignmentController],
  providers: [RolesGuard, CrmService, CrmAssignmentService, CrmDealsService],
  imports: [
    ClientsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-insecure-secret-change-me',
      }),
    }),
  ],
  exports: [CrmService, CrmAssignmentService, CrmDealsService],
})
export class CrmModule {}
