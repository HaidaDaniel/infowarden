import { Controller, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmbeddingsService } from './embeddings.service';

@ApiTags('embeddings')
@Controller('embeddings')
export class EmbeddingsController {
  constructor(private readonly embeddingsService: EmbeddingsService) {}

  @Post('embed')
  @ApiOperation({ summary: 'Generate embeddings for texts' })
  @ApiResponse({ status: 200, description: 'Return embeddings' })
  async embed(@Body() body: { texts: string[] }) {
    const embeddings = await this.embeddingsService.embedTexts(body.texts);
    return { embeddings, count: embeddings.length };
  }
}
