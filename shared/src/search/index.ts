/**
 * Full-Text Search Module
 *
 * Provides PostgreSQL tsvector-based full-text search with:
 * - Indexed search using GIN indexes (10-100x faster than ILIKE)
 * - Relevance ranking with ts_rank
 * - Stemming and fuzzy matching
 * - Highlighted matching terms
 * - Weighted multi-column search
 */

export {
  // Query builders
  sanitizeSearchQuery,
  buildSearchCondition,
  buildDynamicSearchCondition,
  buildAdvancedSearchCondition,
  buildRankOrderBy,
  buildRankSelect,
  buildHeadlineSelect,
  buildMinRankCondition,
  buildWeightedTsvector,
  // Migration helpers
  getCreateIndexSQL,
  getCreateTriggerFunctionSQL,
  getCreateTriggerSQL,
  getPopulateSearchVectorSQL,
  getFullTextSearchMigrationSQL,
} from './fullTextSearch.js';

export type {
  SearchConfig,
  RankedSearchResult,
} from './fullTextSearch.js';
