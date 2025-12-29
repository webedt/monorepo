/**
 * Generate OpenAPI Specification
 *
 * This script generates the OpenAPI specification file from the JSDoc annotations
 * in the route files. It can be run as part of the build process or on-demand.
 *
 * Usage:
 *   npx tsx src/scripts/generate-openapi.ts
 *   npm run openapi:generate
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { swaggerSpec } from '../api/swagger/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output directory (root of backend package)
const outputDir = path.join(__dirname, '../..');
const outputPath = path.join(outputDir, 'openapi.json');

// Type the spec for accessing properties
interface OpenAPISpec {
  paths?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

const spec = swaggerSpec as OpenAPISpec;

// Generate and write the spec (with trailing newline for POSIX compliance)
const specJson = JSON.stringify(swaggerSpec, null, 2) + '\n';
fs.writeFileSync(outputPath, specJson);

console.log(`OpenAPI specification generated: ${outputPath}`);
console.log(`  - ${Object.keys(spec.paths || {}).length} paths documented`);
console.log(`  - ${Object.keys(spec.components?.schemas || {}).length} schemas defined`);
