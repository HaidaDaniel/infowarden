import { Module } from '@nestjs/common';
import { GitManager } from './git.manager';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { LocalFolderScanner } from './local-folder.scanner';
import { OutboundUrlPolicy } from './outbound-url-policy';
import { TextCodeParser } from './text-code.parser';
import { UrlCrawler } from './url-crawler';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, LocalFolderScanner, TextCodeParser, GitManager, UrlCrawler, OutboundUrlPolicy],
  exports: [IngestionService, LocalFolderScanner, TextCodeParser, GitManager, UrlCrawler, OutboundUrlPolicy],
})
export class IngestionModule {}
