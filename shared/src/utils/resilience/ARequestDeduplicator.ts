import { AService } from '../../services/abstracts/AService.js';
import type { IRequestDeduplicatorDocumentation } from './requestDeduplicator.doc.js';
import type { IRequestDeduplicatorRegistryDocumentation } from './requestDeduplicator.doc.js';
import type { RequestDeduplicatorConfig } from './requestDeduplicator.doc.js';
import type { RequestDeduplicatorStats } from './requestDeduplicator.doc.js';
import type { DeduplicateOptions } from './requestDeduplicator.doc.js';
import type { DeduplicateResult } from './requestDeduplicator.doc.js';

export type {
  RequestDeduplicatorConfig,
  RequestDeduplicatorStats,
  DeduplicateOptions,
  DeduplicateResult,
} from './requestDeduplicator.doc.js';

export abstract class ARequestDeduplicator extends AService implements IRequestDeduplicatorDocumentation {
  abstract deduplicate<T>(
    key: string,
    operation: () => Promise<T>,
    options?: DeduplicateOptions
  ): Promise<DeduplicateResult<T>>;

  abstract isPending(key: string): boolean;

  abstract getPendingCount(): number;

  abstract getStats(): RequestDeduplicatorStats;

  abstract resetStats(): void;

  abstract cleanup(): number;

  abstract clear(): void;

  abstract stopCleanup(): void;

  abstract startCleanup(): void;
}

export abstract class ARequestDeduplicatorRegistry extends AService implements IRequestDeduplicatorRegistryDocumentation {
  override readonly order: number = -30;

  abstract get(name: string, config?: Partial<RequestDeduplicatorConfig>): ARequestDeduplicator;

  abstract getAllStats(): Record<string, RequestDeduplicatorStats>;

  abstract resetAllStats(): void;

  abstract clearAll(): void;

  abstract size(): number;
}
