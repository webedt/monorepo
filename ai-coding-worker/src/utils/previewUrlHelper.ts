import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from './logger';

/**
 * Configuration from .webedt file
 */
interface WebedtConfig {
  preview_url?: string;
  [key: string]: any;
}

/**
 * Get the preview URL for the current repository and branch
 *
 * Priority:
 * 1. Check for .webedt file in repository root and use preview_url if exists
 * 2. Fall back to default: https://github.etdofresh.com/{owner}/{repo}/{branch}/
 *
 * @param workspacePath - Path to the git repository workspace
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branch - Branch name
 * @returns The preview URL
 */
export async function getPreviewUrl(
  workspacePath: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  try {
    // Try to read .webedt file from repository root
    const webedtPath = path.join(workspacePath, '.webedt');

    try {
      const webedtContent = await fs.readFile(webedtPath, 'utf-8');
      const config: WebedtConfig = JSON.parse(webedtContent);

      if (config.preview_url) {
        logger.info('Using preview URL from .webedt file', {
          component: 'PreviewUrlHelper',
          previewUrl: config.preview_url
        });
        return config.preview_url;
      } else {
        logger.info('.webedt file exists but no preview_url field found, using default', {
          component: 'PreviewUrlHelper'
        });
      }
    } catch (error) {
      // .webedt file doesn't exist or is invalid - this is expected for most repos
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to parse .webedt file, using default preview URL', {
          component: 'PreviewUrlHelper',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Use default preview URL
    const defaultUrl = `https://github.etdofresh.com/${owner}/${repo}/${branch}/`;
    logger.info('Using default preview URL', {
      component: 'PreviewUrlHelper',
      previewUrl: defaultUrl,
      owner,
      repo,
      branch
    });

    return defaultUrl;
  } catch (error) {
    logger.error('Error generating preview URL', error, {
      component: 'PreviewUrlHelper',
      owner,
      repo,
      branch
    });

    // Return default URL even on error
    return `https://github.etdofresh.com/${owner}/${repo}/${branch}/`;
  }
}

/**
 * Check if .webedt file exists in the repository
 *
 * @param workspacePath - Path to the git repository workspace
 * @returns true if .webedt file exists
 */
export async function hasWebedtFile(workspacePath: string): Promise<boolean> {
  try {
    const webedtPath = path.join(workspacePath, '.webedt');
    await fs.access(webedtPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the .webedt configuration file if it exists
 *
 * @param workspacePath - Path to the git repository workspace
 * @returns The parsed .webedt config or null if not found/invalid
 */
export async function readWebedtConfig(workspacePath: string): Promise<WebedtConfig | null> {
  try {
    const webedtPath = path.join(workspacePath, '.webedt');
    const content = await fs.readFile(webedtPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to read .webedt file', {
        component: 'PreviewUrlHelper',
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }
}
