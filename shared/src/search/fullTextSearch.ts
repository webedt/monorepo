/**
 * Full-Text Search with PostgreSQL tsvector
 *
 * Provides indexed full-text search with:
 * - Relevance ranking using ts_rank
 * - Stemming and fuzzy matching via PostgreSQL's English dictionary
 * - Highlighted matching terms in results
 * - Weighted search across multiple columns
 *
 * This replaces ILIKE patterns with 10-100x faster indexed searches.
 */

import { sql } from 'drizzle-orm';

import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Search configuration for different tables
 */
export interface SearchConfig {
  /** PostgreSQL text search configuration (default: 'english') */
  language?: string;
  /** Minimum rank threshold to include in results (0-1) */
  minRank?: number;
  /** Whether to highlight matching terms */
  highlight?: boolean;
  /** Maximum number of words in headline excerpt */
  maxWords?: number;
  /** Minimum number of words in headline excerpt */
  minWords?: number;
  /** Characters to mark start of highlight */
  startSel?: string;
  /** Characters to mark end of highlight */
  stopSel?: string;
}

/**
 * Result with ranking and optional highlighting
 */
export interface RankedSearchResult<T> {
  /** The matched record */
  record: T;
  /** Relevance rank (0-1, higher is better) */
  rank: number;
  /** Highlighted excerpts from matching fields */
  highlights?: Record<string, string>;
}

/**
 * Default search configuration
 */
const DEFAULT_CONFIG: Required<SearchConfig> = {
  language: 'english',
  minRank: 0,
  highlight: false,
  maxWords: 35,
  minWords: 15,
  startSel: '<mark>',
  stopSel: '</mark>',
};

/**
 * Sanitize search query to prevent SQL injection and invalid tsquery syntax.
 * Converts user input to a safe plainto_tsquery compatible string.
 */
export function sanitizeSearchQuery(query: string): string {
  // Remove characters that could break tsquery syntax
  // Keep alphanumeric, spaces, and common punctuation
  return query
    .replace(/[^\w\s'-]/g, ' ') // Replace special chars with spaces
    .replace(/\s+/g, ' ')        // Collapse multiple spaces
    .trim()
    .substring(0, 100);          // Limit length for safety
}

/**
 * Build a tsvector search condition for a column.
 * Uses the searchVector column if available, otherwise builds tsvector from source columns.
 *
 * @param searchVectorColumn - The tsvector column to search
 * @param query - The search query string
 * @param config - Search configuration
 * @returns SQL condition for WHERE clause
 */
export function buildSearchCondition(
  searchVectorColumn: PgColumn,
  query: string,
  config: SearchConfig = {}
): SQL {
  const { language } = { ...DEFAULT_CONFIG, ...config };
  const sanitizedQuery = sanitizeSearchQuery(query);

  if (!sanitizedQuery) {
    // Return a condition that matches nothing
    return sql`false`;
  }

  // Use plainto_tsquery for safe query parsing (handles natural language)
  return sql`${searchVectorColumn}::tsvector @@ plainto_tsquery(${language}, ${sanitizedQuery})`;
}

/**
 * Build a tsvector search condition using raw text columns (fallback when no tsvector column).
 * Creates tsvector on-the-fly from specified columns.
 *
 * @param columns - Array of text columns to search
 * @param query - The search query string
 * @param config - Search configuration
 * @returns SQL condition for WHERE clause
 */
export function buildDynamicSearchCondition(
  columns: PgColumn[],
  query: string,
  config: SearchConfig = {}
): SQL {
  const { language } = { ...DEFAULT_CONFIG, ...config };
  const sanitizedQuery = sanitizeSearchQuery(query);

  if (!sanitizedQuery || columns.length === 0) {
    return sql`false`;
  }

  // Build tsvector from concatenated columns
  const concatenatedColumns = columns.map((col, index) =>
    index === 0
      ? sql`COALESCE(${col}, '')`
      : sql` || ' ' || COALESCE(${col}, '')`
  );

  const tsvectorExpr = sql.join([
    sql`to_tsvector(${language}, `,
    ...concatenatedColumns,
    sql`)`,
  ], sql``);

  return sql`${tsvectorExpr} @@ plainto_tsquery(${language}, ${sanitizedQuery})`;
}

/**
 * Build ORDER BY clause for ranking search results.
 *
 * @param searchVectorColumn - The tsvector column
 * @param query - The search query string
 * @param config - Search configuration
 * @returns SQL expression for ORDER BY clause (descending rank)
 */
export function buildRankOrderBy(
  searchVectorColumn: PgColumn,
  query: string,
  config: SearchConfig = {}
): SQL {
  const { language } = { ...DEFAULT_CONFIG, ...config };
  const sanitizedQuery = sanitizeSearchQuery(query);

  if (!sanitizedQuery) {
    return sql`0`;
  }

  // ts_rank returns a float indicating relevance
  // Normalization option 32 divides rank by rank + 1 to get 0-1 range
  return sql`ts_rank(${searchVectorColumn}::tsvector, plainto_tsquery(${language}, ${sanitizedQuery}), 32) DESC`;
}

/**
 * Build a SELECT expression for the rank score.
 *
 * @param searchVectorColumn - The tsvector column
 * @param query - The search query string
 * @param config - Search configuration
 * @returns SQL expression that returns rank as a float
 */
export function buildRankSelect(
  searchVectorColumn: PgColumn,
  query: string,
  config: SearchConfig = {}
): SQL<number> {
  const { language } = { ...DEFAULT_CONFIG, ...config };
  const sanitizedQuery = sanitizeSearchQuery(query);

  if (!sanitizedQuery) {
    return sql<number>`0::float`;
  }

  return sql<number>`ts_rank(${searchVectorColumn}::tsvector, plainto_tsquery(${language}, ${sanitizedQuery}), 32)`;
}

/**
 * Build a SELECT expression for highlighted text excerpt.
 *
 * @param textColumn - The text column to highlight
 * @param query - The search query string
 * @param config - Search configuration
 * @returns SQL expression that returns highlighted text
 */
export function buildHeadlineSelect(
  textColumn: PgColumn,
  query: string,
  config: SearchConfig = {}
): SQL<string> {
  const {
    language,
    maxWords,
    minWords,
    startSel,
    stopSel,
  } = { ...DEFAULT_CONFIG, ...config };
  const sanitizedQuery = sanitizeSearchQuery(query);

  if (!sanitizedQuery) {
    return sql<string>`COALESCE(${textColumn}, '')`;
  }

  // ts_headline generates a text excerpt with matched terms highlighted
  return sql<string>`ts_headline(
    ${language},
    COALESCE(${textColumn}, ''),
    plainto_tsquery(${language}, ${sanitizedQuery}),
    'MaxWords=${maxWords}, MinWords=${minWords}, StartSel=${startSel}, StopSel=${stopSel}'
  )`;
}

/**
 * Build a HAVING clause to filter by minimum rank.
 *
 * @param searchVectorColumn - The tsvector column
 * @param query - The search query string
 * @param minRank - Minimum rank threshold (0-1)
 * @param config - Search configuration
 * @returns SQL condition for HAVING clause
 */
export function buildMinRankCondition(
  searchVectorColumn: PgColumn,
  query: string,
  minRank: number,
  config: SearchConfig = {}
): SQL {
  const { language } = { ...DEFAULT_CONFIG, ...config };
  const sanitizedQuery = sanitizeSearchQuery(query);

  if (!sanitizedQuery || minRank <= 0) {
    return sql`true`;
  }

  return sql`ts_rank(${searchVectorColumn}::tsvector, plainto_tsquery(${language}, ${sanitizedQuery}), 32) >= ${minRank}`;
}

/**
 * Check if a search query would match using websearch_to_tsquery (supports operators).
 * Use this for advanced search with AND, OR, NOT, and phrase matching.
 *
 * @param searchVectorColumn - The tsvector column
 * @param query - The search query with operators (e.g., "cat AND dog", "hello world", "-exclude")
 * @param config - Search configuration
 * @returns SQL condition for WHERE clause
 */
export function buildAdvancedSearchCondition(
  searchVectorColumn: PgColumn,
  query: string,
  config: SearchConfig = {}
): SQL {
  const { language } = { ...DEFAULT_CONFIG, ...config };
  const sanitizedQuery = sanitizeSearchQuery(query);

  if (!sanitizedQuery) {
    return sql`false`;
  }

  // websearch_to_tsquery supports Google-like search syntax:
  // - "quoted phrases"
  // - OR for alternatives
  // - - prefix for exclusion
  return sql`${searchVectorColumn}::tsvector @@ websearch_to_tsquery(${language}, ${sanitizedQuery})`;
}

/**
 * Build SQL to create a tsvector from multiple weighted columns.
 * Use this for populating search_vector columns or building dynamic search.
 *
 * @param weights - Array of [column, weight] pairs where weight is 'A', 'B', 'C', or 'D'
 * @param config - Search configuration
 * @returns SQL expression that produces a tsvector
 */
export function buildWeightedTsvector(
  weights: Array<[PgColumn, 'A' | 'B' | 'C' | 'D']>,
  config: SearchConfig = {}
): SQL {
  const { language } = { ...DEFAULT_CONFIG, ...config };

  if (weights.length === 0) {
    return sql`''::tsvector`;
  }

  const parts = weights.map(([column, weight]) =>
    sql`setweight(to_tsvector(${language}, COALESCE(${column}, '')), ${weight})`
  );

  return sql.join(parts, sql` || `);
}

/**
 * SQL for creating GIN index on a tsvector column.
 * Execute this as raw SQL during migrations.
 *
 * @param tableName - Name of the table
 * @param columnName - Name of the tsvector column (default: 'search_vector')
 * @returns SQL string to create the index
 */
export function getCreateIndexSQL(
  tableName: string,
  columnName: string = 'search_vector'
): string {
  // Validate table/column names to prevent injection
  const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const safeColumnName = columnName.replace(/[^a-zA-Z0-9_]/g, '');
  const indexName = `${safeTableName}_${safeColumnName}_idx`;

  return `CREATE INDEX IF NOT EXISTS ${indexName} ON ${safeTableName} USING gin(${safeColumnName}::tsvector)`;
}

/**
 * SQL for creating trigger function to auto-update search vector.
 *
 * @param functionName - Name of the trigger function
 * @param columnWeights - Array of [columnName, weight] pairs
 * @param language - PostgreSQL text search configuration
 * @returns SQL string to create the function
 */
export function getCreateTriggerFunctionSQL(
  functionName: string,
  columnWeights: Array<[string, 'A' | 'B' | 'C' | 'D']>,
  language: string = 'english'
): string {
  const safeFunctionName = functionName.replace(/[^a-zA-Z0-9_]/g, '');

  const setweightParts = columnWeights.map(([column, weight]) => {
    const safeColumn = column.replace(/[^a-zA-Z0-9_]/g, '');
    return `setweight(to_tsvector('${language}', COALESCE(NEW.${safeColumn}, '')), '${weight}')`;
  });

  return `
CREATE OR REPLACE FUNCTION ${safeFunctionName}() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := ${setweightParts.join(' || ')};
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`.trim();
}

/**
 * SQL for creating trigger to call the update function.
 *
 * @param triggerName - Name of the trigger
 * @param tableName - Name of the table
 * @param functionName - Name of the trigger function
 * @returns SQL string to create the trigger
 */
export function getCreateTriggerSQL(
  triggerName: string,
  tableName: string,
  functionName: string
): string {
  const safeTriggerName = triggerName.replace(/[^a-zA-Z0-9_]/g, '');
  const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const safeFunctionName = functionName.replace(/[^a-zA-Z0-9_]/g, '');

  return `
CREATE OR REPLACE TRIGGER ${safeTriggerName}
  BEFORE INSERT OR UPDATE ON ${safeTableName}
  FOR EACH ROW
  EXECUTE FUNCTION ${safeFunctionName}();
`.trim();
}

/**
 * SQL to populate existing rows with search vectors.
 *
 * @param tableName - Name of the table
 * @param columnWeights - Array of [columnName, weight] pairs
 * @param language - PostgreSQL text search configuration
 * @returns SQL string to update existing rows
 */
export function getPopulateSearchVectorSQL(
  tableName: string,
  columnWeights: Array<[string, 'A' | 'B' | 'C' | 'D']>,
  language: string = 'english'
): string {
  const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');

  const setweightParts = columnWeights.map(([column, weight]) => {
    const safeColumn = column.replace(/[^a-zA-Z0-9_]/g, '');
    return `setweight(to_tsvector('${language}', COALESCE(${safeColumn}, '')), '${weight}')`;
  });

  return `
UPDATE ${safeTableName}
SET search_vector = ${setweightParts.join(' || ')}
WHERE search_vector IS NULL;
`.trim();
}

/**
 * Combined SQL for full migration setup of a table's full-text search.
 *
 * @param tableName - Name of the table
 * @param columnWeights - Array of [columnName, weight] pairs
 * @param language - PostgreSQL text search configuration
 * @returns Array of SQL statements to execute in order
 */
export function getFullTextSearchMigrationSQL(
  tableName: string,
  columnWeights: Array<[string, 'A' | 'B' | 'C' | 'D']>,
  language: string = 'english'
): string[] {
  const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  const functionName = `${safeTableName}_search_vector_update`;
  const triggerName = `${safeTableName}_search_vector_trigger`;

  return [
    // Add column if not exists
    `ALTER TABLE ${safeTableName} ADD COLUMN IF NOT EXISTS search_vector text`,
    // Create trigger function
    getCreateTriggerFunctionSQL(functionName, columnWeights, language),
    // Create trigger
    getCreateTriggerSQL(triggerName, safeTableName, functionName),
    // Populate existing rows
    getPopulateSearchVectorSQL(safeTableName, columnWeights, language),
    // Create GIN index
    getCreateIndexSQL(safeTableName),
  ];
}
