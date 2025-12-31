/**
 * Schema Drift Detection
 *
 * Pre-deployment validation to detect mismatches between Drizzle schema
 * definitions and actual database schema. Use this to catch schema issues
 * in CI before production deployment.
 *
 * Features:
 * - Extracts expected schema from Drizzle table definitions
 * - Compares against actual PostgreSQL database schema
 * - Detects missing/extra tables, columns, type mismatches
 * - Validates indexes and constraints
 * - Generates migration suggestions for detected drift
 * - Auto-generates EXPECTED_TABLES from Drizzle schema
 */

import pg from 'pg';
import * as schema from './schema.js';

import type { PgColumn } from 'drizzle-orm/pg-core';

// ============================================================================
// TYPES
// ============================================================================

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  definition: string;
}

export interface ForeignKeyInfo {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
  onUpdate: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface SchemaDiff {
  missingTables: string[];
  extraTables: string[];
  missingColumns: { table: string; column: string; expected: ColumnInfo }[];
  extraColumns: { table: string; column: string }[];
  typeMismatches: {
    table: string;
    column: string;
    expected: string;
    actual: string;
  }[];
  nullabilityMismatches: {
    table: string;
    column: string;
    expected: boolean;
    actual: boolean;
  }[];
  missingIndexes: { table: string; index: IndexInfo }[];
  extraIndexes: { table: string; index: string }[];
}

export interface SchemaDriftResult {
  hasDrift: boolean;
  diffs: SchemaDiff;
  migrationSuggestions: string[];
  summary: string;
}

export interface ExpectedTable {
  name: string;
  requiredColumns: string[];
}

// ============================================================================
// DRIZZLE SCHEMA EXTRACTION
// ============================================================================

/**
 * Map Drizzle column types to PostgreSQL types
 */
function drizzleTypeToPostgres(column: PgColumn): string {
  const columnType = column.columnType;
  const dataType = column.dataType;

  // Handle serial types
  if (columnType === 'PgSerial') {
    return 'integer'; // PostgreSQL stores serial as integer
  }

  // Handle text types
  if (columnType === 'PgText' || dataType === 'string') {
    return 'text';
  }

  // Handle boolean
  if (columnType === 'PgBoolean' || dataType === 'boolean') {
    return 'boolean';
  }

  // Handle integer
  if (columnType === 'PgInteger' || dataType === 'number') {
    return 'integer';
  }

  // Handle timestamp
  if (columnType === 'PgTimestamp') {
    // Check if withTimezone
    const config = (column as unknown as { config?: { withTimezone?: boolean } }).config;
    if (config?.withTimezone) {
      return 'timestamp with time zone';
    }
    return 'timestamp without time zone';
  }

  // Handle JSON/JSONB
  if (columnType === 'PgJsonb' || columnType === 'PgJson') {
    return 'jsonb';
  }

  // Fallback to dataType or 'text'
  return dataType || 'text';
}

/**
 * Extract column info from a Drizzle column definition
 */
function extractColumnInfo(columnName: string, column: PgColumn): ColumnInfo {
  return {
    name: column.name,
    type: drizzleTypeToPostgres(column),
    nullable: !column.notNull,
    defaultValue: column.hasDefault ? 'HAS_DEFAULT' : null,
    isPrimaryKey: column.primary,
  };
}

/**
 * Drizzle table internal interface for accessing table metadata
 */
interface DrizzleTableInternal {
  _: { name: string };
}

/**
 * Extract table schema from Drizzle table definition
 */
function extractTableSchema(table: unknown): TableSchema {
  // Get table name from internal Drizzle structure
  const tableInternal = table as DrizzleTableInternal;
  const tableName = tableInternal._.name;

  const columns: ColumnInfo[] = [];
  const tableRecord = table as Record<string, unknown>;

  for (const [colKey, column] of Object.entries(tableRecord)) {
    // Skip non-column properties (like _ and Symbol properties)
    if (colKey === '_') continue;
    if (!column || typeof column !== 'object') continue;
    if (!('name' in column) || !('columnType' in column)) continue;

    columns.push(extractColumnInfo(colKey, column as PgColumn));
  }

  return {
    name: tableName,
    columns,
    indexes: [], // Will be populated from actual DB
    foreignKeys: [], // Will be populated from actual DB
  };
}

/**
 * Get all table definitions from the Drizzle schema
 */
export function getDrizzleTableSchemas(): Map<string, TableSchema> {
  const tables = new Map<string, TableSchema>();

  for (const [, value] of Object.entries(schema)) {
    // Skip non-table exports (types, constants, etc.)
    if (!value || typeof value !== 'object') continue;

    // Check if it's a Drizzle table (has the _ property with name)
    const valueObj = value as { _?: { name?: string } };
    const hasUnderscore = valueObj._ &&
      typeof valueObj._ === 'object' &&
      typeof valueObj._.name === 'string';

    if (hasUnderscore) {
      try {
        const tableSchema = extractTableSchema(value);
        if (tableSchema.name && tableSchema.columns.length > 0) {
          tables.set(tableSchema.name, tableSchema);
        }
      } catch {
        // Skip items that can't be processed as tables
      }
    }
  }

  return tables;
}

/**
 * Auto-generate EXPECTED_TABLES array from Drizzle schema
 * This eliminates manual maintenance of the array
 */
export function generateExpectedTables(): ExpectedTable[] {
  const drizzleTables = getDrizzleTableSchemas();
  const expectedTables: ExpectedTable[] = [];

  for (const [, tableSchema] of drizzleTables) {
    expectedTables.push({
      name: tableSchema.name,
      requiredColumns: tableSchema.columns.map(c => c.name),
    });
  }

  // Sort by table name for consistent output
  expectedTables.sort((a, b) => a.name.localeCompare(b.name));

  return expectedTables;
}

// ============================================================================
// DATABASE SCHEMA EXTRACTION
// ============================================================================

/**
 * Get actual table list from the database
 */
async function getActualTables(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  return result.rows.map(row => row.table_name);
}

/**
 * Get actual column info from the database
 */
async function getActualColumns(pool: pg.Pool, tableName: string): Promise<ColumnInfo[]> {
  const result = await pool.query(`
    SELECT
      column_name,
      data_type,
      is_nullable,
      column_default,
      CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = $1
      AND tc.constraint_type = 'PRIMARY KEY'
    ) pk ON c.column_name = pk.column_name
    WHERE c.table_schema = 'public'
    AND c.table_name = $1
    ORDER BY c.ordinal_position;
  `, [tableName]);

  return result.rows.map(row => ({
    name: row.column_name,
    type: normalizePostgresType(row.data_type),
    nullable: row.is_nullable === 'YES',
    defaultValue: row.column_default ? 'HAS_DEFAULT' : null,
    isPrimaryKey: row.is_primary_key,
  }));
}

/**
 * Get actual indexes from the database
 */
async function getActualIndexes(pool: pg.Pool, tableName: string): Promise<IndexInfo[]> {
  const result = await pool.query(`
    SELECT
      i.relname as index_name,
      array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns,
      ix.indisunique as is_unique,
      pg_get_indexdef(ix.indexrelid) as definition
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.relname = $1
    AND n.nspname = 'public'
    AND NOT ix.indisprimary
    GROUP BY i.relname, ix.indisunique, ix.indexrelid
    ORDER BY i.relname;
  `, [tableName]);

  return result.rows.map(row => ({
    name: row.index_name,
    columns: row.columns,
    isUnique: row.is_unique,
    definition: row.definition,
  }));
}

/**
 * Normalize PostgreSQL type names for comparison
 */
function normalizePostgresType(type: string): string {
  // Normalize common type variations
  const normalized = type.toLowerCase()
    .replace(/character varying/g, 'text')
    .replace(/varchar/g, 'text')
    .replace(/timestamp with time zone/g, 'timestamp with time zone')
    .replace(/timestamp without time zone/g, 'timestamp without time zone')
    .replace(/^timestamp$/g, 'timestamp without time zone')
    .replace(/jsonb/g, 'jsonb')
    .replace(/json/g, 'jsonb');

  return normalized;
}

// ============================================================================
// SCHEMA COMPARISON
// ============================================================================

/**
 * Compare expected types with flexibility for equivalent types
 */
function typesMatch(expected: string, actual: string): boolean {
  const e = expected.toLowerCase();
  const a = actual.toLowerCase();

  // Exact match
  if (e === a) return true;

  // Serial is stored as integer
  if (e === 'integer' && a === 'integer') return true;

  // Text variations
  if ((e === 'text' || e === 'varchar' || e === 'character varying') &&
      (a === 'text' || a === 'varchar' || a === 'character varying')) {
    return true;
  }

  // JSON/JSONB
  if ((e === 'json' || e === 'jsonb') && (a === 'json' || a === 'jsonb')) {
    return true;
  }

  // Timestamp variations
  if (e.startsWith('timestamp') && a.startsWith('timestamp')) {
    return true; // Accept any timestamp variation
  }

  return false;
}

/**
 * Compare Drizzle schema against actual database schema
 */
export async function detectSchemaDrift(pool: pg.Pool): Promise<SchemaDriftResult> {
  const drizzleTables = getDrizzleTableSchemas();
  const actualTables = await getActualTables(pool);

  const diffs: SchemaDiff = {
    missingTables: [],
    extraTables: [],
    missingColumns: [],
    extraColumns: [],
    typeMismatches: [],
    nullabilityMismatches: [],
    missingIndexes: [],
    extraIndexes: [],
  };

  const drizzleTableNames = new Set(drizzleTables.keys());
  const actualTableSet = new Set(actualTables);

  // System tables to ignore
  const systemTables = new Set([
    '__drizzle_migrations',
    'drizzle_migrations',
    'pg_stat_statements',
  ]);

  // Find missing tables (in Drizzle but not in DB)
  for (const tableName of drizzleTableNames) {
    if (!actualTableSet.has(tableName)) {
      diffs.missingTables.push(tableName);
    }
  }

  // Find extra tables (in DB but not in Drizzle)
  for (const tableName of actualTables) {
    if (!drizzleTableNames.has(tableName) && !systemTables.has(tableName)) {
      diffs.extraTables.push(tableName);
    }
  }

  // Compare columns for existing tables
  for (const [tableName, expectedSchema] of drizzleTables) {
    if (!actualTableSet.has(tableName)) continue; // Skip missing tables

    const actualColumns = await getActualColumns(pool, tableName);
    const actualColumnMap = new Map(actualColumns.map(c => [c.name, c]));
    const expectedColumnNames = new Set(expectedSchema.columns.map(c => c.name));

    // Find missing columns
    for (const expectedCol of expectedSchema.columns) {
      const actualCol = actualColumnMap.get(expectedCol.name);

      if (!actualCol) {
        diffs.missingColumns.push({
          table: tableName,
          column: expectedCol.name,
          expected: expectedCol,
        });
        continue;
      }

      // Check type mismatch
      if (!typesMatch(expectedCol.type, actualCol.type)) {
        diffs.typeMismatches.push({
          table: tableName,
          column: expectedCol.name,
          expected: expectedCol.type,
          actual: actualCol.type,
        });
      }

      // Check nullability mismatch (only report if column is NOT NULL in schema but nullable in DB)
      if (!expectedCol.nullable && actualCol.nullable) {
        diffs.nullabilityMismatches.push({
          table: tableName,
          column: expectedCol.name,
          expected: expectedCol.nullable,
          actual: actualCol.nullable,
        });
      }
    }

    // Find extra columns (in DB but not in schema)
    for (const actualCol of actualColumns) {
      if (!expectedColumnNames.has(actualCol.name)) {
        diffs.extraColumns.push({
          table: tableName,
          column: actualCol.name,
        });
      }
    }
  }

  // Generate migration suggestions
  const suggestions = generateMigrationSuggestions(diffs);

  // Build summary
  const hasDrift = diffs.missingTables.length > 0 ||
    diffs.missingColumns.length > 0 ||
    diffs.typeMismatches.length > 0 ||
    diffs.nullabilityMismatches.length > 0;

  const summaryParts: string[] = [];
  if (diffs.missingTables.length > 0) {
    summaryParts.push(`${diffs.missingTables.length} missing table(s)`);
  }
  if (diffs.extraTables.length > 0) {
    summaryParts.push(`${diffs.extraTables.length} extra table(s)`);
  }
  if (diffs.missingColumns.length > 0) {
    summaryParts.push(`${diffs.missingColumns.length} missing column(s)`);
  }
  if (diffs.extraColumns.length > 0) {
    summaryParts.push(`${diffs.extraColumns.length} extra column(s)`);
  }
  if (diffs.typeMismatches.length > 0) {
    summaryParts.push(`${diffs.typeMismatches.length} type mismatch(es)`);
  }
  if (diffs.nullabilityMismatches.length > 0) {
    summaryParts.push(`${diffs.nullabilityMismatches.length} nullability mismatch(es)`);
  }

  const summary = summaryParts.length > 0
    ? `Schema drift detected: ${summaryParts.join(', ')}`
    : 'No schema drift detected';

  return {
    hasDrift,
    diffs,
    migrationSuggestions: suggestions,
    summary,
  };
}

// ============================================================================
// MIGRATION SUGGESTIONS
// ============================================================================

/**
 * Generate SQL migration suggestions for detected drift
 */
function generateMigrationSuggestions(diffs: SchemaDiff): string[] {
  const suggestions: string[] = [];

  // Missing tables
  for (const tableName of diffs.missingTables) {
    suggestions.push(`-- Missing table: ${tableName}`);
    suggestions.push(`-- Run: npx drizzle-kit push`);
    suggestions.push(`-- Or manually create the table using the schema definition`);
    suggestions.push('');
  }

  // Missing columns
  for (const { table, column, expected } of diffs.missingColumns) {
    const nullable = expected.nullable ? '' : ' NOT NULL';
    const defaultClause = expected.defaultValue ? ' DEFAULT ...' : '';
    suggestions.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${expected.type}${nullable}${defaultClause};`);
  }

  // Type mismatches (these require careful migration)
  for (const { table, column, expected, actual } of diffs.typeMismatches) {
    suggestions.push(`-- Type mismatch: ${table}.${column}`);
    suggestions.push(`-- Expected: ${expected}, Actual: ${actual}`);
    suggestions.push(`-- WARNING: Type changes may require data migration`);
    suggestions.push(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${expected};`);
    suggestions.push('');
  }

  // Nullability mismatches
  for (const { table, column, expected } of diffs.nullabilityMismatches) {
    if (!expected) {
      suggestions.push(`-- Column ${table}.${column} should be NOT NULL`);
      suggestions.push(`-- First ensure no NULL values exist:`);
      suggestions.push(`-- UPDATE ${table} SET ${column} = 'default_value' WHERE ${column} IS NULL;`);
      suggestions.push(`ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`);
      suggestions.push('');
    }
  }

  return suggestions;
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Format schema drift result for console output
 */
export function formatSchemaDriftResult(result: SchemaDriftResult): string {
  const lines: string[] = [];

  if (!result.hasDrift) {
    lines.push('Schema validation passed');
    lines.push('No drift detected between Drizzle schema and database');
    return lines.join('\n');
  }

  lines.push('Schema Drift Detected');
  lines.push('='.repeat(60));
  lines.push('');

  const { diffs } = result;

  if (diffs.missingTables.length > 0) {
    lines.push('Missing Tables (in schema but not in database):');
    for (const table of diffs.missingTables) {
      lines.push(`  - ${table}`);
    }
    lines.push('');
  }

  if (diffs.extraTables.length > 0) {
    lines.push('Extra Tables (in database but not in schema):');
    for (const table of diffs.extraTables) {
      lines.push(`  - ${table}`);
    }
    lines.push('');
  }

  if (diffs.missingColumns.length > 0) {
    lines.push('Missing Columns:');
    for (const { table, column, expected } of diffs.missingColumns) {
      lines.push(`  - ${table}.${column} (${expected.type}${expected.nullable ? '' : ' NOT NULL'})`);
    }
    lines.push('');
  }

  if (diffs.extraColumns.length > 0) {
    lines.push('Extra Columns (in database but not in schema):');
    for (const { table, column } of diffs.extraColumns) {
      lines.push(`  - ${table}.${column}`);
    }
    lines.push('');
  }

  if (diffs.typeMismatches.length > 0) {
    lines.push('Type Mismatches:');
    for (const { table, column, expected, actual } of diffs.typeMismatches) {
      lines.push(`  - ${table}.${column}: expected ${expected}, got ${actual}`);
    }
    lines.push('');
  }

  if (diffs.nullabilityMismatches.length > 0) {
    lines.push('Nullability Mismatches:');
    for (const { table, column, expected, actual } of diffs.nullabilityMismatches) {
      lines.push(`  - ${table}.${column}: expected nullable=${expected}, got nullable=${actual}`);
    }
    lines.push('');
  }

  if (result.migrationSuggestions.length > 0) {
    lines.push('='.repeat(60));
    lines.push('Migration Suggestions:');
    lines.push('='.repeat(60));
    lines.push('');
    for (const suggestion of result.migrationSuggestions) {
      lines.push(suggestion);
    }
  }

  return lines.join('\n');
}

/**
 * Format expected tables as TypeScript code for migrations.ts
 */
export function formatExpectedTablesAsCode(tables: ExpectedTable[]): string {
  const lines: string[] = [];
  lines.push('const EXPECTED_TABLES = [');

  for (const table of tables) {
    lines.push('  {');
    lines.push(`    name: '${table.name}',`);
    lines.push('    requiredColumns: [');

    // Format columns in groups of 4 per line for readability
    const cols = table.requiredColumns;
    for (let i = 0; i < cols.length; i += 4) {
      const chunk = cols.slice(i, i + 4);
      const isLast = i + 4 >= cols.length;
      const colStrings = chunk.map(c => `'${c}'`).join(', ');
      lines.push(`      ${colStrings}${isLast ? '' : ','}`);
    }

    lines.push('    ]');
    lines.push('  },');
  }

  lines.push('];');
  return lines.join('\n');
}
