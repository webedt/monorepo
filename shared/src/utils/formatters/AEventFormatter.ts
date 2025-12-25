import { AService } from '../../services/abstracts/AService.js';

export interface FormattedEvent {
  lines: string[];
  skip: boolean;
}

export abstract class AEventFormatter extends AService {
  readonly order = 0;

  abstract formatEvent(event: Record<string, unknown>): string;

  abstract getMessageLines(event: Record<string, unknown>): string[];

  abstract getMessagePreview(event: Record<string, unknown>): string | null;

  abstract formatEventMultiline(event: Record<string, unknown>): FormattedEvent;
}
