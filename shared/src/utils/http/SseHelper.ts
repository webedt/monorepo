import { ASseHelper } from './ASseHelper.js';

import type { SseWritable } from './ASseHelper.js';

export class SseHelper extends ASseHelper {
  setupSse(res: SseWritable): void {
    if (res.setHeader) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }
  }

  write(res: SseWritable, data: string): boolean {
    if (!this.isWritable(res)) {
      return false;
    }

    try {
      const writeResult = res.write(data);

      if (res.flush) {
        res.flush();
      }

      return writeResult !== false;
    } catch {
      return false;
    }
  }

  writeEvent(res: SseWritable, event: Record<string, unknown>): boolean {
    return this.write(res, `data: ${JSON.stringify(event)}\n\n`);
  }

  writeHeartbeat(res: SseWritable): boolean {
    return this.write(res, ': heartbeat\n\n');
  }

  isWritable(res: SseWritable): boolean {
    if (res.writableEnded || res.writableFinished) {
      return false;
    }
    if (res.socket && res.socket.destroyed) {
      return false;
    }
    return true;
  }

  end(res: SseWritable): void {
    if (this.isWritable(res)) {
      res.end();
    }
  }
}

export const sseHelper = new SseHelper();
