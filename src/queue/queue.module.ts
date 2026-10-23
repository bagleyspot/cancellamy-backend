import { Global, Module } from '@nestjs/common';
import { DispatchQueueService } from './dispatch-queue.service';

@Global()
@Module({
  providers: [DispatchQueueService],
  exports: [DispatchQueueService],
})
export class QueueModule {}
