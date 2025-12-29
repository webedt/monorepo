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

  /**
   * Write a named SSE event with explicit event type.
   * Format: event: <type>\ndata: <json>\n\n
   *
   * @param res - The writable response
   * @param eventType - The SSE event name (e.g., 'completed', 'error', 'session-created')
   * @param data - The event data to serialize as JSON
   * @returns true if write succeeded, false otherwise
   */
  abstract writeNamedEvent(res: SseWritable, eventType: string, data: Record<string, unknown>): boolean;

  /**
   * Write an event with an ID for Last-Event-ID support.
   * The event ID allows clients to resume from where they left off after reconnection.
   */
  abstract writeEventWithId(res: SseWritable, eventId: string, event: Record<string, unknown>): boolean;

  /**
   * Write a named event with an ID for Last-Event-ID support.
   * Format: id: <eventId>\nevent: <type>\ndata: <json>\n\n
   */
  abstract writeNamedEventWithId(res: SseWritable, eventId: string, eventType: string, data: Record<string, unknown>): boolean;

  abstract writeHeartbeat(res: SseWritable): boolean;

  /**
   * Write an SSE comment.
   * Format: : <comment>\n\n
   * Comments are ignored by SSE clients but keep the connection alive.
   */
  abstract writeComment(res: SseWritable, comment: string): boolean;

  abstract isWritable(res: SseWritable): boolean;

  abstract end(res: SseWritable): void;
}
