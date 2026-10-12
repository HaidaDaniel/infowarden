import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { VectorIndexModule } from "../vector-index/vector-index.module";
import { VectorBackendsController } from "./vector-backends.controller";
import { VectorBackendsService } from "./vector-backends.service";

@Module({
  imports: [PrismaModule, VectorIndexModule],
  controllers: [VectorBackendsController],
  providers: [VectorBackendsService],
  exports: [VectorBackendsService],
})
export class VectorBackendsModule {}
