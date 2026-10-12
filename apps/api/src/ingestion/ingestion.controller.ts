import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { IngestionService } from './ingestion.service';

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post('scan')
  @ApiOperation({ summary: 'Scan a local folder for files' })
  @ApiResponse({ status: 200, description: 'Return scanned files' })
  scanFolder(@Body() body: { folderPath: string; includeRules?: string[]; excludeRules?: string[] }) {
    const files = this.ingestionService.scanFolder(body.folderPath, {
      includeRules: body.includeRules,
      excludeRules: body.excludeRules,
    });
    return { files, count: files.length };
  }

  @Get('scan')
  @ApiOperation({ summary: 'Scan a local folder for files (GET)' })
  @ApiQuery({ name: 'folderPath', required: true })
  @ApiResponse({ status: 200, description: 'Return scanned files' })
  scanFolderGet(
    @Query('folderPath') folderPath: string,
    @Query('includeRules') includeRules?: string,
    @Query('excludeRules') excludeRules?: string,
  ) {
    const files = this.ingestionService.scanFolder(folderPath, {
      includeRules: includeRules ? JSON.parse(includeRules) : undefined,
      excludeRules: excludeRules ? JSON.parse(excludeRules) : undefined,
    });
    return { files, count: files.length };
  }

  @Post('parse')
  @ApiOperation({ summary: 'Parse a single file' })
  @ApiResponse({ status: 200, description: 'Return parsed document' })
  parseFile(@Body() body: { absolutePath: string; relativePath: string }) {
    return this.ingestionService.parseFile(body.absolutePath, body.relativePath);
  }

  @Post('scan-and-parse')
  @ApiOperation({ summary: 'Scan and parse a local folder' })
  @ApiResponse({ status: 200, description: 'Return parsed files' })
  scanAndParse(@Body() body: { folderPath: string; includeRules?: string[]; excludeRules?: string[] }) {
    const results = this.ingestionService.scanAndParse(body.folderPath, {
      includeRules: body.includeRules,
      excludeRules: body.excludeRules,
    });
    const parsedCount = results.filter((r) => r.parsed !== null).length;
    return { results, total: results.length, parsed: parsedCount };
  }
}
