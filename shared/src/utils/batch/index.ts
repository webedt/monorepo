/**
 * Batch operation utilities
 * @module utils/batch
 */

// Abstract class and types
export {
  ABatchOperationHandler,
  type BatchItemResult,
  type BatchProgress,
  type BatchOperationConfig,
  type BatchOperationResult,
} from './ABatchOperationHandler.js';

// Implementation
export {
  BatchOperationHandler,
  getBatchOperationHandler,
  executeBatch,
  executeBatchChunked,
  resetBatchOperationHandlerForTesting,
} from './batchOperationHandler.js';
