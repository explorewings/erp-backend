import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root(): { status: string; message: string; service: string; basePath: string; health: string } {
    return {
      status: 'ok',
      message: 'backend is healthy',
      service: 'explore-wings-erp-api',
      basePath: '/rest/v1',
      health: '/rest/v1/health',
    }
  }

  @Get('health')
  health(): { status: string; service: string } {
    return { status: 'ok', service: 'explore-wings-erp-api' };
  }
}
