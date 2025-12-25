import { AService } from '../../services/abstracts/AService.js';

export interface SseWritable {
  writableEnded?: boolean;
  writableFinished?: boolean;
  socket?: { destroyed?: boolean } | null;
  write(data: string): boolean;
  end(): void;
  setHeader?(name: string, value: string): void;
  flush?(): void;
}

export abstract class ASseHelper extends AService {
  readonly order = 0;

  abstract setupSse(res: SseWritable): void;

  abstract write(res: SseWritable, data: string): boolean;

  abstract writeEvent(res: SseWritable, event: Record<string, unknown>): boolean;

  abstract writeHeartbeat(res: SseWritable): boolean;

  abstract isWritable(res: SseWritable): boolean;

  abstract end(res: SseWritable): void;
}
