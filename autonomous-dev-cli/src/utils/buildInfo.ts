import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface BuildInfo {
  buildDate: string;
  buildId: string;
}

/**
 * Load build info from the build-info.json file created during Docker build.
 * Returns default values if the file doesn't exist (local development).
 */
export function getBuildInfo(): BuildInfo {
  const buildInfoPath = join(process.cwd(), 'build-info.json');

  // Also check /app for Docker container
  const dockerPath = '/app/build-info.json';

  let infoPath: string | null = null;
  if (existsSync(buildInfoPath)) {
    infoPath = buildInfoPath;
  } else if (existsSync(dockerPath)) {
    infoPath = dockerPath;
  }

  if (infoPath) {
    try {
      const content = readFileSync(infoPath, 'utf-8');
      const info = JSON.parse(content) as BuildInfo;
      return {
        buildDate: info.buildDate || 'unknown',
        buildId: info.buildId || 'unknown',
      };
    } catch {
      // Fall through to default
    }
  }

  // Default for local development
  return {
    buildDate: 'local',
    buildId: 'dev',
  };
}

/**
 * Format build info for display
 * Example: "2025-12-13 20:54:07 UTC [ccc7746]"
 */
export function formatBuildInfo(): string {
  const info = getBuildInfo();
  return `${info.buildDate} [${info.buildId}]`;
}
