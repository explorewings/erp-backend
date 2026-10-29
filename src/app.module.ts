import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database.module';
import { AppController } from './app.controller';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { PackagesModule } from './packages/packages.module';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    DatabaseModule,
    UsersModule,
    SettingsModule,
    PackagesModule,
    AccessModule,
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
