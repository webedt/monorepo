import { AService } from '../services/abstracts/AService.js';

import type { ChatSession } from '../db/schema.js';

export interface SessionQueryOptions {
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface SessionSearchOptions {
  query: string;
  limit?: number;
  offset?: number;
  status?: string;
  favorite?: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface SessionWithPreview extends ChatSession {
  previewUrl?: string;
}

export abstract class ASessionQueryService extends AService {
  readonly order = 0;

  abstract getById(
    sessionId: string
  ): Promise<ChatSession | null>;

  abstract getByIdForUser(
    sessionId: string,
    userId: string
  ): Promise<ChatSession | null>;

  abstract getByIdWithPreview(
    sessionId: string,
    userId: string
  ): Promise<SessionWithPreview | null>;

  abstract listActive(
    userId: string,
    options?: SessionQueryOptions
  ): Promise<ChatSession[]>;

  abstract listDeleted(
    userId: string,
    options?: SessionQueryOptions
  ): Promise<PaginatedResult<ChatSession>>;

  abstract listByIds(
    sessionIds: string[],
    userId: string
  ): Promise<ChatSession[]>;

  abstract existsForUser(
    sessionId: string,
    userId: string
  ): Promise<boolean>;

  abstract countActive(
    userId: string
  ): Promise<number>;

  abstract countDeleted(
    userId: string
  ): Promise<number>;

  abstract search(
    userId: string,
    options: SessionSearchOptions
  ): Promise<PaginatedResult<ChatSession>>;
}
