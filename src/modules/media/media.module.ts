import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { CloudinaryMediaStorage, MediaStorage } from './media-storage';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    { provide: MediaStorage, useClass: CloudinaryMediaStorage },
  ],
  exports: [MediaService, MediaStorage],
})
export class MediaModule {}
