/**
 * Preview URL Helper
 * Generates preview URLs for deployments based on repository and branch info
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from './logger.js';

/**
 * Configuration from .webedt file
 */
interface WebedtConfig {
  preview_url?: string;
  [key: string]: unknown;
}

/**
 * Get the preview URL for the current repository and branch
 *
 * Priority:
 * 1. Check for .webedt file in repository root and use preview_url if exists
 * 2. Fall back to default: https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/
 *
 * @param workspacePath - Path to the git repository workspace (optional)
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branch - Branch name
 * @returns The preview URL
 */
export async function getPreviewUrl(
  workspacePath: string | undefined,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  try {
    // If workspace path is provided, try to read .webedt file
    if (workspacePath) {
      try {
        const webedtPath = path.join(workspacePath, '.webedt');
        const webedtContent = await fs.readFile(webedtPath, 'utf-8');
        const config: WebedtConfig = JSON.parse(webedtContent);

        if (config.preview_url) {
          logger.info('Using preview URL from .webedt file', {
            component: 'PreviewUrlHelper',
            previewUrl: config.preview_url
          });
          return config.preview_url;
        }
      } catch (error) {
        // .webedt file doesn't exist or is invalid - this is expected for most repos
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('Failed to parse .webedt file, using default preview URL', {
            component: 'PreviewUrlHelper'
          });
        }
      }
    }

    // Use default preview URL
    // Replace forward slashes in branch name with dashes for URL safety
    const safeBranch = branch.replace(/\//g, '-');
    const defaultUrl = `https://webedt.etdofresh.com/github/${owner}/${repo}/${safeBranch}/`;
    logger.debug('Using default preview URL', {
      component: 'PreviewUrlHelper',
      previewUrl: defaultUrl
    });

    return defaultUrl;
  } catch (error) {
    logger.error('Error generating preview URL', error, { component: 'PreviewUrlHelper' });

    // Return default URL even on error
    // Replace forward slashes in branch name with dashes for URL safety
    const safeBranch = branch.replace(/\//g, '-');
    return `https://webedt.etdofresh.com/github/${owner}/${repo}/${safeBranch}/`;
  }
}

/**
 * Get the preview URL from session metadata
 * Convenience method for use with ChatSession objects
 *
 * @param session - Chat session with repository information
 * @param workspacePath - Optional workspace path to check for .webedt file
 * @returns The preview URL or null if session doesn't have repository info
 */
export async function getPreviewUrlFromSession(
  session: {
    repositoryOwner: string | null;
    repositoryName: string | null;
    branch: string | null;
  },
  workspacePath?: string
): Promise<string | null> {
  if (!session.repositoryOwner || !session.repositoryName || !session.branch) {
    return null;
  }

  return getPreviewUrl(
    workspacePath,
    session.repositoryOwner,
    session.repositoryName,
    session.branch
  );
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
      logger.warn('Failed to read .webedt file', { component: 'PreviewUrlHelper' });
    }
    return null;
  }
}

export type { WebedtConfig };
