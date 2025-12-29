import type { IShutdownManagerDocumentation } from './shutdownManager.doc.js';
import type { IShutdownHandler } from './shutdownManager.doc.js';
import type { ShutdownResult } from './shutdownManager.doc.js';
import type { ShutdownManagerConfig } from './shutdownManager.doc.js';
import type { ShutdownManagerStats } from './shutdownManager.doc.js';

export type {
  IShutdownHandler,
  ShutdownResult,
  ShutdownManagerConfig,
  ShutdownManagerStats,
  HandlerResult,
} from './shutdownManager.doc.js';

export { ShutdownPriority } from './shutdownManager.doc.js';

export abstract class AShutdownManager implements IShutdownManagerDocumentation {
  abstract register(handler: IShutdownHandler): void;

  abstract unregister(name: string): boolean;

  abstract shutdown(reason: string, config?: ShutdownManagerConfig): Promise<ShutdownResult>;

  abstract isShuttingDown(): boolean;

  abstract getStats(): ShutdownManagerStats;

  abstract reset(): void;
}
