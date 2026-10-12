import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { VectorIndexController } from "./vector-index.controller";
import { VectorIndexService } from "./vector-index.service";
import { QdrantAdapter } from "./qdrant.adapter";

@Module({
  imports: [PrismaModule],
  controllers: [VectorIndexController],
  providers: [VectorIndexService, QdrantAdapter],
  exports: [VectorIndexService, QdrantAdapter],
})
export class VectorIndexModule {}
