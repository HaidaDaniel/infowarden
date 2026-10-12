import { Body, Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UploadSourceDto } from './dto/upload-source.dto';
import { UploadedManagedFile } from './managed-upload-storage.service';
import { UploadSourcesService } from './upload-sources.service';

@ApiTags('sources')
@Controller()
export class UploadSourcesController {
  constructor(private readonly uploadSourcesService: UploadSourcesService) {}

  @Post('workspaces/:identifier/sources/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a managed dataset file or ZIP archive as a workspace source' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        includeRules: { type: 'string' },
        excludeRules: { type: 'string' },
        sourceName: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Managed upload source created' })
  async uploadWorkspaceSource(
    @Param('identifier') identifier: string,
    @UploadedFile() file: UploadedManagedFile,
    @Body() dto: UploadSourceDto,
  ) {
    return this.uploadSourcesService.createManagedUploadSource(identifier, file, dto);
  }

  @Post('knowledge-bases/:identifier/sources/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a managed dataset file or ZIP archive as a knowledge-base source' })
  @ApiResponse({ status: 201, description: 'Managed upload source created' })
  async uploadKnowledgeBaseSource(
    @Param('identifier') identifier: string,
    @UploadedFile() file: UploadedManagedFile,
    @Body() dto: UploadSourceDto,
  ) {
    return this.uploadSourcesService.createManagedUploadSource(identifier, file, dto);
  }
}
