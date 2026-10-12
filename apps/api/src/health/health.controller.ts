import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('database')
  async checkDatabase() {
    return this.healthService.checkDatabase();
  }

  @Get('full')
  async checkAll() {
    return this.healthService.checkAll();
  }

  @Get('embeddings')
  async checkEmbeddings() {
    return this.healthService.checkEmbeddings();
  }
}
